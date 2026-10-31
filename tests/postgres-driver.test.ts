import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {addAttachment,readAttachment} from '../server/attachments.ts';
import {Store} from '../server/store.ts';
import {Auth} from '../server/auth.ts';
import {importRun} from '../server/imports.ts';
test('PostgreSQL wire driver, migrations, transactions and report replay',{skip:!process.env.TEST_POSTGRES_URL},async()=>{
 const connection=process.env.TEST_POSTGRES_URL!,pool=new Pool({connectionString:connection}),schema=`qh_${randomUUID().replaceAll('-','')}`;
 await pool.query(`CREATE SCHEMA ${schema}`);
 const url=new URL(connection);url.searchParams.set('options',`-c search_path=${schema}`);
 const store=new Store(url.toString());
 try{
  const auth=new Auth(store),user=await auth.register({name:'Postgres owner',email:'pg@example.test',password:'Synthetic-password-123!'});
  const p=await auth.createProject(user.id,'Postgres project','');
  const c=await store.createCase(p.id,{title:'Transactional checkout',suite:'Commerce',priority:'high',steps:['Submit order'],expected:'Confirmation appears'});
  await store.updateCase(p.id,c.id,1,{...c,title:'Updated checkout'});
  await assert.rejects(()=>store.updateCase(p.id,c.id,1,c),/has changed/);
  const payload={externalId:'postgres-ci-1',name:'Postgres reporter run',tests:[{externalId:'login',title:'Customer can sign in',suite:'chromium',attempts:[{retry:0,status:'passed',durationMs:10}]}]};
  assert.equal((await importRun(store,p.id,payload)).replayed,false);
  assert.equal((await importRun(store,p.id,payload)).replayed,true);
  const baseline=(await store.runs(p.id))[0];
  assert.equal(baseline.passed,1);
  const candidate=await importRun(store,p.id,{...payload,externalId:'postgres-ci-2',tests:[{...payload.tests[0],attempts:[{retry:0,status:'failed',durationMs:25,error:'Regression'}]}]});
  const comparison=await store.compareRuns(p.id,baseline.id,candidate.run.id);
  assert.equal(comparison.summary.regression,1);
  assert.equal(comparison.rows[0].durationDeltaMs,15);
  const attachment=await addAttachment(store,p.id,candidate.run.results[0].id,{filename:'driver.log',kind:'log',retry:0,contentBase64:Buffer.from('Driver evidence').toString('base64')});
  assert.equal(Buffer.from((await readAttachment(store,p.id,attachment.id)).content_base64,'base64').toString(),'Driver evidence');
  assert.equal((await auth.projects(user.id)).length,1);
 }finally{await store.close();await pool.query(`DROP SCHEMA ${schema} CASCADE`);await pool.end();}
});
