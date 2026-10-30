import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../server/store.ts';
import {Auth} from '../server/auth.ts';
import {importRun} from '../server/imports.ts';
const report={externalId:'ci-run-001',name:'Automated regression',tests:[{externalId:'checkout-confirmation',title:'Checkout confirms order',suite:'chromium',expectedStatus:'passed',attempts:[{retry:0,status:'failed',durationMs:100,error:'Missing confirmation'},{retry:1,status:'passed',durationMs:50,error:''}]}]};
for(const database of [':memory:','pglite:']){
 test(`${database} · invitation-bound accounts, session revocation and project token scope`,async()=>{
  const store=new Store(database),auth=new Auth(store);
  try{
   const owner=await auth.register({name:'Owner',email:'owner@example.test',password:'Synthetic-password-123!'});
   const p=await auth.createProject(owner.id,'Secure project','');
   await assert.rejects(()=>auth.register({name:'Stranger',email:'stranger@example.test',password:'Synthetic-password-123!'}),/invitation/);
   const invite=await auth.invite(p.id,'tester@example.test','tester');
   await assert.rejects(()=>auth.register({name:'Wrong',email:'wrong@example.test',password:'Synthetic-password-123!',invite:invite.invite}),/invitation/);
   const tester=await auth.register({name:'Tester',email:'tester@example.test',password:'Synthetic-password-123!',invite:invite.invite});
   assert.equal(await auth.role(tester.id,p.id,'write'),'tester');await assert.rejects(()=>auth.role(tester.id,p.id,'owner'),/role/);
   await assert.rejects(()=>auth.changeMember(p.id,owner.id,null),/at least one owner/);
   await auth.changeMember(p.id,tester.id,'viewer');await assert.rejects(()=>auth.role(tester.id,p.id,'write'),/role/);
   await auth.changeMember(p.id,tester.id,'tester');
   const session=await auth.login('tester@example.test','Synthetic-password-123!'),identity=await auth.identify(session.token);assert.equal(identity?.id,tester.id);
   await auth.logout(identity!);assert.equal(await auth.identify(session.token),null);
   const token=await auth.token(p.id,'CI tests');assert.ok(await auth.tokenIdentity(token.token,p.id));
   const other=await auth.createProject(owner.id,'Other project','');assert.equal(await auth.tokenIdentity(token.token,other.id),undefined);
   const records=await auth.tokens(p.id);assert.equal(records[0].token_hash,undefined);
   await auth.revoke(p.id,records[0].id);assert.equal(await auth.tokenIdentity(token.token,p.id),undefined);
  }finally{await store.close();}
 });
 test(`${database} · imports are atomic, idempotent, preserve retries and reject changed replay`,async()=>{
  const store=new Store(database);
  try{
   const p=await store.createProject('Automation project','');
   const first=await importRun(store,p.id,report);assert.equal(first.replayed,false);assert.equal(first.run.status,'completed');assert.equal(first.run.results[0].status,'passed');
   assert.equal((await store.all('SELECT * FROM automation_attempts')).length,2);
   assert.equal((await importRun(store,p.id,report)).replayed,true);assert.equal((await store.runs(p.id)).length,1);
   await assert.rejects(()=>importRun(store,p.id,{...report,name:'Changed payload'}),/different payload/);
   const parallel={...report,externalId:'ci-run-parallel'};await Promise.all([importRun(store,p.id,parallel),importRun(store,p.id,parallel)]);assert.equal((await store.runs(p.id)).length,2);
   assert.equal((await store.cases(p.id)).length,1);
   await assert.rejects(()=>importRun(store,p.id,{...report,externalId:'duplicate-tests',tests:[report.tests[0],report.tests[0]]}),/Duplicate external/);
   assert.equal((await store.runs(p.id)).length,2);
  }finally{await store.close();}
 });
}
