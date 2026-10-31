import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import Reporter from '../integrations/playwright-reporter.ts';
import {Store} from '../server/store.ts';
import {Auth} from '../server/auth.ts';
import {listAttachments,readAttachment} from '../server/attachments.ts';
import {createApp} from '../server/app.ts';
test('Playwright reporter saves evidence, uploads retries and replays without duplicates',async()=>{
 const store=new Store(),p=await store.createProject('Reporter integration',''),auth=new Auth(store),token=await auth.token(p.id,'Reporter test');
 const server=createApp(store).listen(0,'127.0.0.1');await once(server,'listening');
 const dir=await mkdtemp(join(tmpdir(),'qualityhub-reporter-'));
 const config={QUALITYHUB_URL:`http://127.0.0.1:${(server.address() as any).port}`,QUALITYHUB_PROJECT_ID:p.id,QUALITYHUB_TOKEN:token.token,QUALITYHUB_REPOSITORY:'mileevskiyy/OrderFlow',QUALITYHUB_COMMIT:'a'.repeat(40),QUALITYHUB_SCENARIO:'integration-test',QUALITYHUB_RUN_ID:'reporter-test-run-1',QUALITYHUB_REPORT_PATH:join(dir,'report.json')};
 const previous={...process.env};Object.assign(process.env,config);
 try{
  const logPath=join(dir,'browser-console.log');await writeFile(logPath,'Expected dashboard');
  const reporter=new Reporter();reporter.onBegin({rootDir:'/tests'} as any);
  const testcase={title:'Customer can sign in',expectedStatus:'passed',location:{file:'/tests/login.spec.ts'},titlePath:()=>['chromium','Authentication','Customer can sign in'],parent:{project:()=>({name:'chromium'})}} as any;
  reporter.onTestEnd(testcase,{retry:0,status:'failed',duration:50,errors:[{message:'Expected dashboard'}],attachments:[{name:'console.log',contentType:'text/plain',path:logPath},{name:'trace',contentType:'application/zip',body:Buffer.from('UEsFBgAAAAAAAAAAAAAAAAAAAAAAAA==','base64')}]} as any);
  reporter.onTestEnd(testcase,{retry:1,status:'passed',duration:20,errors:[]} as any);
  await reporter.onEnd({status:'passed'} as any);await reporter.onEnd({status:'passed'} as any);
  const report=JSON.parse(await readFile(config.QUALITYHUB_REPORT_PATH,'utf8'));assert.equal(report.source.commit,'a'.repeat(40));assert.equal((await store.run(p.id,(await store.runs(p.id))[0].id)).automation.source.repository,'mileevskiyy/OrderFlow');assert.equal(report.tests[0].attempts.length,2);assert.equal(report.attachments.length,2);
  const result=(await store.run(p.id,(await store.runs(p.id))[0].id)).results[0];
  const evidence=await listAttachments(store,p.id,result.id);assert.equal(evidence.length,2);assert.ok(evidence.every(a=>a.retry===0));
  const stored=await readAttachment(store,p.id,evidence.find(a=>a.kind==='log')!.id);assert.equal(Buffer.from(stored.content_base64,'base64').toString(),'Expected dashboard');
  assert.equal((await store.runs(p.id)).length,1);assert.equal((await store.runs(p.id))[0].passed,1);
  const serverToken=await auth.tokens(p.id);await auth.revoke(p.id,serverToken[0].id);
  await assert.rejects(()=>reporter.onEnd({status:'passed'} as any),/HTTP 401/);
 }finally{for(const key of Object.keys(config)){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}await new Promise<void>(resolve=>server.close(()=>resolve()));await store.close();await rm(dir,{recursive:true,force:true});}
});
