import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../server/store.ts';
import {importRun} from '../server/imports.ts';
for(const database of [':memory:','pglite:'])test(`${database} · source metadata belongs to immutable imported evidence and changed replay conflicts`,async()=>{
 const store=new Store(database);
 try{
  const p=await store.createProject('Source evidence','');
  const report={externalId:'source-ci-1',name:'Source report',source:{repository:'mileevskiyy/OrderFlow',commit:'a'.repeat(40),buildUrl:'https://github.com/mileevskiyy/OrderFlow/actions/runs/123',scenario:'controlled-failure',dirty:false},tests:[{externalId:'checkout',title:'Checkout completes',suite:'chromium',attempts:[{retry:0,status:'passed',durationMs:20}]}]};
  const first=await importRun(store,p.id,report);assert.deepEqual(first.run.automation.source,report.source);
  assert.equal((await importRun(store,p.id,report)).replayed,true);
  await assert.rejects(()=>importRun(store,p.id,{...report,source:{...report.source,commit:'b'.repeat(40)}}),/different payload/);
  assert.deepEqual((await store.run(p.id,first.run.id)).automation.source,report.source);
  await assert.rejects(()=>importRun(store,p.id,{...report,externalId:'bad-url',source:{...report.source,buildUrl:'javascript:alert(1)'}}));
  const legacy=await importRun(store,p.id,{externalId:'legacy-ci',name:'Legacy report',tests:report.tests});assert.equal(legacy.run.automation.source,null);
 }finally{await store.close();}
});
