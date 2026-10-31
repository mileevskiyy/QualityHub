import type { Reporter, TestCase, TestResult, FullConfig, FullResult } from '@playwright/test/reporter';
import { writeFile, mkdir, readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, basename } from 'node:path';
/** A report file is always written before any network request so delivery can be retried. */
export default class QualityHubReporter implements Reporter {
 private tests=new Map<string,{externalId:string;title:string;suite:string;expectedStatus:string;attempts:any[]}>();
 private root='';
 private attachments:any[]=[];
 private attachmentBytes=0;
 private attachmentWork=Promise.resolve();
 private attachmentError:unknown;
 onBegin(config:FullConfig){this.root=config.rootDir;}
 onTestEnd(test:TestCase,result:TestResult){
  const path=test.titlePath().filter(Boolean),project=test.parent.project()?.name||'default';
  const stable=`${project}:${test.location.file.replace(this.root,'')}:${path.join(' / ')}`;
  const externalId=createHash('sha256').update(stable).digest('hex');
  const entry=this.tests.get(externalId)||{externalId,title:(test.title.length<3?`Test: ${test.title}`:test.title).slice(0,180),suite:project.slice(0,80),expectedStatus:test.expectedStatus,attempts:[]};
  entry.attempts.push({retry:result.retry,status:result.status,durationMs:Math.round(result.duration),error:result.errors.map(e=>e.message||'').join('\n').slice(0,12000)});this.tests.set(externalId,entry);
  this.attachmentWork=this.attachmentWork.then(async()=>{
  for(const attachment of result.attachments||[]){
   const type=attachment.contentType,kind=['image/png','image/jpeg','image/webp'].includes(type)?'screenshot':type.startsWith('text/')||type==='application/json'?'log':attachment.name==='trace'&&type==='application/zip'?'trace':null;
   if(!kind)continue;
   const size=attachment.body?.length??(attachment.path?(await stat(attachment.path)).size:0);
   if(!size||size>4*1024*1024||this.attachmentBytes+size>64*1024*1024||this.attachments.filter(a=>a.testExternalId===externalId).length>=20){console.warn('QualityHub: attachment omitted because an evidence size/count limit was reached.');continue;}
   const bytes=attachment.body??await readFile(attachment.path!);
   if(bytes.length>4*1024*1024)throw new Error('Attachment changed while reading; retry from saved evidence.');
   this.attachmentBytes+=bytes.length;
   this.attachments.push({testExternalId:externalId,retry:result.retry,filename:basename(attachment.path||attachment.name).replace(/[\x00-\x1f\x7f\\]/g,'_').slice(0,160)||'evidence',kind,contentBase64:bytes.toString('base64')});
  }
  }).catch(e=>{this.attachmentError=e;});
 }
 async onEnd(_result:FullResult){
  await this.attachmentWork;
  const externalId=process.env.QUALITYHUB_RUN_ID;
  if(!externalId)throw new Error('QUALITYHUB_RUN_ID is required. Use a stable unique ID for this CI execution.');
  const report={externalId,name:process.env.QUALITYHUB_RUN_NAME||'Playwright regression',tests:[...this.tests.values()]};
  const path=process.env.QUALITYHUB_REPORT_PATH||'test-results/qualityhub-report.json';await mkdir(dirname(path),{recursive:true});await writeFile(path,JSON.stringify({...report,attachments:this.attachments},null,2));
  if(this.attachmentError)throw new Error('Could not collect all attachments; the partial report is saved locally.',{cause:this.attachmentError});
  const url=process.env.QUALITYHUB_URL,project=process.env.QUALITYHUB_PROJECT_ID,token=process.env.QUALITYHUB_TOKEN;
  if(!url||!project||!token){console.log(`QualityHub: report saved to ${path}. Configure URL, project ID and token for upload.`);return;}
  const target=new URL(url);
  if(!['http:','https:'].includes(target.protocol)||(target.protocol!=='https:'&&!['127.0.0.1','localhost'].includes(target.hostname)))throw new Error('Use HTTPS when uploading a report outside localhost.');
  const endpoint=new URL(`/api/projects/${encodeURIComponent(project)}/imports/playwright`,target);
  const send=async(endpoint:URL,body:unknown)=>{
   for(let attempt=0;attempt<3;attempt++){
    try{const response=await fetch(endpoint,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
     if(response.ok)return;
     if(response.status<500)throw new Error(`QualityHub rejected evidence: HTTP ${response.status}`);
    }catch(e){if(attempt===2||String(e).includes('rejected evidence'))throw e;}
    await new Promise(resolve=>setTimeout(resolve,500*(attempt+1)));
   }
   throw new Error('QualityHub upload failed. The local report file is available for retry.');
  };
  await send(endpoint,report);
  const attachmentEndpoint=new URL(`/api/projects/${encodeURIComponent(project)}/imports/playwright/attachments`,target);
  for(const attachment of this.attachments)await send(attachmentEndpoint,{...attachment,runExternalId:externalId});
  console.log(`QualityHub: report imported with ${this.attachments.length} attachments.`);
 }
}
