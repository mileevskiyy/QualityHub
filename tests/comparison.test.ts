import test from 'node:test';
import assert from 'node:assert/strict';
import { Store, type CaseInput } from '../server/store.ts';
import { importRun } from '../server/imports.ts';

const input:CaseInput={title:'Checkout submits successfully',suite:'Checkout',priority:'high',preconditions:'Basket has a product',steps:['Submit order'],expected:'Confirmation appears'};
for(const database of [':memory:','pglite:']) {
 test(`${database} · comparison separates changed definitions, true outcome transitions and run membership`,async()=>{
  const store=new Store(database);
  try {
   const p=await store.createProject('Comparison project','');
   const cases=await Promise.all(['Regression','Fixed','Changed','Blocked','Unchanged','Omitted','Added'].map(title=>store.createCase(p.id,{...input,title:`${title} checkout scenario`})));
   const baseline=await store.createRun(p.id,'Baseline release',cases.slice(0,6).map(c=>c.id));
   const before=['passed','failed','passed','passed','skipped','passed'];
   for(let i=0;i<baseline.results.length;i++) await store.setResult(p.id,baseline.id,baseline.results[i].id,before[i],'Baseline observation',1);
   await store.completeRun(p.id,baseline.id);
   await store.updateCase(p.id,cases[2].id,1,{...input,title:'Changed checkout scenario',expected:'A new definition'});
   const candidate=await store.createRun(p.id,'Candidate release',cases.filter((_,i)=>i!==5).map(c=>c.id));
   const after=['failed','passed','failed','blocked','skipped','passed'];
   for(let i=0;i<candidate.results.length;i++) await store.setResult(p.id,candidate.id,candidate.results[i].id,after[i],'Candidate observation',1);
   await assert.rejects(()=>store.compareRuns(p.id,baseline.id,candidate.id),/Complete both/);
   await store.completeRun(p.id,candidate.id);
   await store.archiveCase(p.id,cases[0].id,1);
   const comparison=await store.compareRuns(p.id,baseline.id,candidate.id);
   assert.deepEqual(comparison.summary,{regression:1,fixed:1,definition_changed:1,status_changed:1,unchanged:1,omitted:1,added:1});
   const changed=comparison.rows.find(r=>r.caseId===cases[2].id)!;
   assert.equal(changed.baseline!.snapshot.expected,input.expected);
   assert.equal(changed.candidate!.snapshot.expected,'A new definition');
   assert.ok(comparison.rows.every(r=>r.baselineDurationMs===null&&r.candidateDurationMs===null&&r.durationDeltaMs===null));
   assert.equal((await store.compareRuns(p.id,candidate.id,baseline.id)).summary.regression,1);
   await assert.rejects(()=>store.compareRuns(p.id,baseline.id,baseline.id),/different/);
   const foreign=await store.createProject('Foreign project',''),foreignRun=await store.createRun(foreign.id,'Foreign run',[(await store.createCase(foreign.id,input)).id]);
   await assert.rejects(()=>store.compareRuns(p.id,baseline.id,foreignRun.id),/not found/);
   assert.equal((await store.run(p.id,baseline.id)).results[0].status,'passed');
  } finally { await store.close(); }
 });
 test(`${database} · automated duration uses final retry and maps stable IDs rather than report order`,async()=>{
  const store=new Store(database);
  try {
   const p=await store.createProject('Automation comparison','');
   const report=(externalId:string,tests:any[])=>({externalId,name:externalId,tests});
   const check=(externalId:string,durationMs:number,retry=0)=>({externalId,title:`Test ${externalId}`,suite:'API',attempts:[...(retry?[{retry:0,status:'failed',durationMs:900,error:'First attempt'}]:[]),{retry,status:'passed',durationMs,error:''}]});
   const a=(await importRun(store,p.id,report('Baseline automation',[check('checkout',80,1),check('login',40)]))).run;
   const b=(await importRun(store,p.id,report('Candidate automation',[check('login',0),check('checkout',120)]))).run;
   const c=await store.compareRuns(p.id,a.id,b.id),checkout=c.rows.find(r=>r.title==='Test checkout')!;
   assert.equal(c.summary.unchanged,2);
   assert.equal(checkout.baselineDurationMs,80);assert.equal(checkout.candidateDurationMs,120);assert.equal(checkout.durationDeltaMs,40);
   assert.equal(c.rows.find(r=>r.title==='Test login')!.durationDeltaMs,-40);
  } finally { await store.close(); }
 });
}
