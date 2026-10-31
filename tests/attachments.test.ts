import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../server/store.ts';
import {addAttachment,listAttachments,readAttachment,validateAttachment} from '../server/attachments.ts';
const log={filename:'console.log',kind:'log',contentBase64:Buffer.from('Error: missing confirmation\n').toString('base64')};
for(const database of [':memory:','pglite:']){
 test(`${database} · evidence is scoped, immutable, retry-safe and retained independently of completed outcomes`,async()=>{
  const store=new Store(database);
  try{
   const p=await store.createProject('Evidence project',''),c=await store.createCase(p.id,{title:'Checkout completes',suite:'Checkout',priority:'high',steps:['Submit'],expected:'Confirmed'}),run=await store.createRun(p.id,'Release evidence',[c.id]),r=run.results[0];
   await store.setResult(p.id,run.id,r.id,'failed','Missing confirmation',1);await store.completeRun(p.id,run.id);
   const a=await addAttachment(store,p.id,r.id,log),replay=await addAttachment(store,p.id,r.id,log);
   assert.equal(a.id,replay.id);assert.equal(replay.replayed,true);assert.equal(a.content_base64,undefined);
   assert.equal((await listAttachments(store,p.id,r.id)).length,1);assert.equal((await store.run(p.id,run.id)).results[0].revision,2);
   assert.equal((await readAttachment(store,p.id,a.id)).content_base64,log.contentBase64);
   const other=await store.createProject('Other project','');
   await assert.rejects(()=>readAttachment(store,other.id,a.id),/not found/);
   await assert.rejects(()=>listAttachments(store,other.id,r.id),/not found/);
   await assert.rejects(()=>addAttachment(store,other.id,r.id,log),/not found/);
   await assert.rejects(()=>addAttachment(store,p.id,r.id,{...log,retry:0}),/recorded automation attempt/);
   await store.exec('UPDATE attachments SET byte_size=? WHERE id=?',20*1024*1024,a.id);
   await assert.rejects(()=>addAttachment(store,p.id,r.id,{...log,filename:'second.log'}),/storage limit/);
   assert.equal((await listAttachments(store,p.id,r.id)).length,1);
   await store.exec('UPDATE attachments SET expires_at=? WHERE id=?','2000-01-01T00:00:00.000Z',a.id);
   assert.equal((await listAttachments(store,p.id,r.id)).length,0);await assert.rejects(()=>readAttachment(store,p.id,a.id),/expired/);
   const renewed=await addAttachment(store,p.id,r.id,log);assert.notEqual(renewed.id,a.id);assert.equal((await store.all('SELECT id FROM attachments')).length,1);
  }finally{await store.close();}
 });
 test(`${database} · attachment and activity roll back together`,async()=>{
  const store=new Store(database);
  try{
   const p=await store.createProject('Rollback evidence',''),c=await store.createCase(p.id,{title:'Checkout completes',suite:'Checkout',priority:'high',steps:['Submit'],expected:'Confirmed'}),run=await store.createRun(p.id,'Release evidence',[c.id]);
   const original=store.db.exec.bind(store.db);store.db.exec=async(sql,params)=>{if(sql.startsWith('INSERT INTO events'))throw new Error('Injected evidence failure');return original(sql,params);};
   await assert.rejects(()=>addAttachment(store,p.id,run.results[0].id,log),/Injected/);
   assert.equal((await store.all('SELECT id FROM attachments')).length,0);
  }finally{await store.close();}
 });
}
test('attachment validation rejects paths, invalid encodings, active image formats and binary logs',()=>{
 for(const value of [{...log,filename:'../secret.log'},{...log,contentBase64:'!!!!'},{...log,kind:'screenshot'},{...log,kind:'trace'},{...log,contentBase64:Buffer.from([255]).toString('base64')},{...log,contentBase64:Buffer.from([0]).toString('base64')},{...log,contentBase64:Buffer.alloc(4*1024*1024+1).toString('base64')}])assert.throws(()=>validateAttachment(value));
 const bytes=Buffer.from('UEsFBgAAAAAAAAAAAAAAAAAAAAAAAA==','base64');assert.equal(validateAttachment({...log,kind:'trace',contentBase64:bytes.toString('base64')}).mime,'application/octet-stream');
});
