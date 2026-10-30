import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Store, DomainError } from './store.ts';
const attempt=z.object({retry:z.number().int().min(0).max(20),status:z.enum(['passed','failed','timedOut','skipped','interrupted']),durationMs:z.number().int().min(0).max(86400000),error:z.string().max(12000).default('')});
export const importInput=z.object({externalId:z.string().trim().min(3).max(180),name:z.string().trim().min(3).max(140),tests:z.array(z.object({externalId:z.string().trim().min(1).max(300),title:z.string().trim().min(3).max(180),suite:z.string().trim().min(1).max(80),expectedStatus:z.enum(['passed','failed','skipped']).default('passed'),attempts:z.array(attempt).min(1).max(21)})).min(1).max(500)});
export async function importRun(store:Store,projectId:string,raw:unknown){
 const input=importInput.parse(raw),hash=createHash('sha256').update(JSON.stringify(input)).digest('hex');
 if(new Set(input.tests.map(t=>t.externalId)).size!==input.tests.length)throw new DomainError(400,'Duplicate external test identifiers.');
 for(const test of input.tests)if(new Set(test.attempts.map(a=>a.retry)).size!==test.attempts.length)throw new DomainError(400,'Duplicate retry numbers.');
 return store.transaction(async()=>{
  await store.requireProject(projectId);
  const previous=await store.one('SELECT * FROM imports WHERE project_id=? AND external_id=?',projectId,input.externalId);
  if(previous){if(previous.payload_hash!==hash)throw new DomainError(409,'This import identifier already belongs to a different payload.');return {run:await store.run(projectId,previous.run_id),replayed:true};}
  const caseIds:string[]=[];
  for(const t of input.tests){
   const external=await store.one('SELECT case_id FROM external_cases WHERE project_id=? AND external_id=?',projectId,t.externalId);
   if(external){const c=await store.one('SELECT archived FROM cases WHERE id=?',external.case_id);if(c.archived)throw new DomainError(409,'An automated test maps to an archived case. Restore or change its external identifier.');caseIds.push(external.case_id);}
   else{const c=await store.createCase(projectId,{title:t.title,suite:t.suite,priority:'medium',preconditions:'Automated Playwright execution',steps:['Execute the mapped automated test.'],expected:`Expected Playwright outcome: ${t.expectedStatus}`});await store.exec('INSERT INTO external_cases VALUES(?,?,?)',projectId,t.externalId,c.id);caseIds.push(c.id);}
  }
  const run=await store.createRun(projectId,input.name,caseIds);
  for(let i=0;i<input.tests.length;i++){
   const t=input.tests[i],r=run.results.find((r:any)=>r.case_id===caseIds[i]);
   const ordered=[...t.attempts].sort((a,b)=>a.retry-b.retry),last=ordered[ordered.length-1];
   const status=last.status==='skipped'?'skipped':last.status==='interrupted'?'blocked':last.status===t.expectedStatus?'passed':'failed';
   const note=`Playwright: ${last.status}; expected: ${t.expectedStatus}. Attempts: ${ordered.length}.\n${last.error}`.trim();
   await store.setResult(projectId,run.id,r.id,status,note,1);
   for(const a of ordered)await store.exec('INSERT INTO automation_attempts VALUES(?,?,?,?,?,?)',randomUUID(),r.id,a.retry,a.status,a.durationMs,a.error);
  }
  await store.completeRun(projectId,run.id);
  await store.exec('INSERT INTO imports VALUES(?,?,?,?,?)',projectId,input.externalId,hash,run.id,new Date().toISOString());
  await store.event(projectId,'automation.imported',`${input.name} · ${input.tests.length} tests`);
  return {run:await store.run(projectId,run.id),replayed:false};
 });
}
