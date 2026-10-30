import type { Reporter, TestCase, TestResult, FullConfig, FullResult } from '@playwright/test/reporter';
import { writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
/** A report file is always written before any network request so delivery can be retried. */
export default class QualityHubReporter implements Reporter {
 private tests=new Map<string,{externalId:string;title:string;suite:string;expectedStatus:string;attempts:any[]}>();
 private root='';
 onBegin(config:FullConfig){this.root=config.rootDir;}
 onTestEnd(test:TestCase,result:TestResult){
  const path=test.titlePath().filter(Boolean),project=test.parent.project()?.name||'default';
  const stable=`${project}:${test.location.file.replace(this.root,'')}:${path.join(' / ')}`;
  const externalId=createHash('sha256').update(stable).digest('hex');
  const entry=this.tests.get(externalId)||{externalId,title:(test.title.length<3?`Test: ${test.title}`:test.title).slice(0,180),suite:project.slice(0,80),expectedStatus:test.expectedStatus,attempts:[]};
  entry.attempts.push({retry:result.retry,status:result.status,durationMs:Math.round(result.duration),error:result.errors.map(e=>e.message||'').join('\n').slice(0,12000)});this.tests.set(externalId,entry);
 }
 async onEnd(_result:FullResult){
  const externalId=process.env.QUALITYHUB_RUN_ID;
  if(!externalId)throw new Error('QUALITYHUB_RUN_ID is required. Use a stable unique ID for this CI execution.');
  const report={externalId,name:process.env.QUALITYHUB_RUN_NAME||'Playwright regression',tests:[...this.tests.values()]};
  const path=process.env.QUALITYHUB_REPORT_PATH||'test-results/qualityhub-report.json';await mkdir(dirname(path),{recursive:true});await writeFile(path,JSON.stringify(report,null,2));
  const url=process.env.QUALITYHUB_URL,project=process.env.QUALITYHUB_PROJECT_ID,token=process.env.QUALITYHUB_TOKEN;
  if(!url||!project||!token){console.log(`QualityHub: report saved to ${path}. Configure URL, project ID and token for upload.`);return;}
  const target=new URL(url);
  if(target.protocol!=='https:'&&!['127.0.0.1','localhost'].includes(target.hostname))throw new Error('Use HTTPS when uploading a report outside localhost.');
  const endpoint=new URL(`/api/projects/${encodeURIComponent(project)}/imports/playwright`,target);
  for(let attempt=0;attempt<3;attempt++){
   try{const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(report),signal:AbortSignal.timeout(15000)});
    if(response.ok){console.log('QualityHub: report imported.');return;}
    if(response.status<500)throw new Error(`QualityHub rejected report: HTTP ${response.status}`);
   }catch(e){if(attempt===2||String(e).includes('rejected report'))throw e;}
   await new Promise(resolve=>setTimeout(resolve,500*(attempt+1)));
  }
  throw new Error('QualityHub report upload failed. The local report file is available for retry.');
 }
}
