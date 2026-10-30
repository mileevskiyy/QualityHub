import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import Reporter from '../integrations/playwright-reporter.ts';
import {Store} from '../server/store.ts';
import {Auth} from '../server/auth.ts';
import {createApp} from '../server/app.ts';
test('Playwright reporter saves evidence, uploads retries and replays without duplicates',async()=>{
 const store=new Store(),p=await store.createProject('Reporter integration',''),auth=new Auth(store),token=await auth.token(p.id,'Reporter test');
 const server=createApp(store).listen(0,'127.0.0.1');await once(server,'listening');
 const dir=await mkdtemp(join(tmpdir(),'qualityhub-reporter-'));
 const config={QUALITYHUB_URL:`http://127.0.0.1:${(server.address() as any).port}`,QUALITYHUB_PROJECT_ID:p.id,QUALITYHUB_TOKEN:token.token,QUALITYHUB_RUN_ID:'reporter-test-run-1',QUALITYHUB_REPORT_PATH:join(dir,'report.json')};
 const previous={...process.env};Object.assign(process.env,config);
 try{
  const reporter=new Reporter();reporter.onBegin({rootDir:'/tests'} as any);
  const testcase={title:'Customer can sign in',expectedStatus:'passed',location:{file:'/tests/login.spec.ts'},titlePath:()=>['chromium','Authentication','Customer can sign in'],parent:{project:()=>({name:'chromium'})}} as any;
  reporter.onTestEnd(testcase,{retry:0,status:'failed',duration:50,errors:[{message:'Expected dashboard'}]} as any);
  reporter.onTestEnd(testcase,{retry:1,status:'passed',duration:20,errors:[]} as any);
  await reporter.onEnd({status:'passed'} as any);await reporter.onEnd({status:'passed'} as any);
  const report=JSON.parse(await readFile(config.QUALITYHUB_REPORT_PATH,'utf8'));assert.equal(report.tests[0].attempts.length,2);
  assert.equal((await store.runs(p.id)).length,1);assert.equal((await store.runs(p.id))[0].passed,1);
  const serverToken=await auth.tokens(p.id);await auth.revoke(p.id,serverToken[0].id);
  await assert.rejects(()=>reporter.onEnd({status:'passed'} as any),/HTTP 401/);
 }finally{for(const key of Object.keys(config)){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}await new Promise<void>(resolve=>server.close(()=>resolve()));await store.close();await rm(dir,{recursive:true,force:true});}
});
