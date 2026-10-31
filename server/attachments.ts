import {createHash,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {Store,DomainError} from './store.ts';
export const MAX_ATTACHMENT_BYTES=4*1024*1024;
export const attachmentInput=z.object({
 filename:z.string().min(1).max(160).refine(s=>!/[\\/\x00-\x1f\x7f]/.test(s),'Use a filename without paths or control characters.'),
 kind:z.enum(['screenshot','log','trace']),
 contentBase64:z.string().min(4).max(Math.ceil(MAX_ATTACHMENT_BYTES/3)*4),
 retry:z.number().int().min(0).max(20).optional()
});
export const attachmentColumns='id,result_id,filename,kind,mime,byte_size,sha256,retry,created_at,expires_at';
export function validateAttachment(raw:unknown){
 const value=attachmentInput.parse(raw);
 if(value.contentBase64.length%4||/[^A-Za-z0-9+/=]/.test(value.contentBase64))throw new DomainError(400,'Invalid base64 attachment.');
 const bytes=Buffer.from(value.contentBase64,'base64');
 if(bytes.toString('base64')!==value.contentBase64)throw new DomainError(400,'Invalid base64 attachment.');
 if(!bytes.length||bytes.length>MAX_ATTACHMENT_BYTES)throw new DomainError(413,'Attachments must be nonempty and at most 4 MiB.');
 let mime='application/octet-stream';
 if(value.kind==='screenshot'){
  if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))mime='image/png';
  else if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)mime='image/jpeg';
  else if(bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP')mime='image/webp';
  else throw new DomainError(400,'Screenshots must be PNG, JPEG or WebP.');
 }else if(value.kind==='trace'){
  if(bytes.toString('hex',0,4)!=='504b0304'&&bytes.toString('hex',0,4)!=='504b0506')throw new DomainError(400,'Trace attachments must be ZIP files.');
 }else{
  try{new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new DomainError(400,'Logs must contain UTF-8 text.');}
  if(bytes.includes(0))throw new DomainError(400,'Logs cannot contain NUL bytes.');
  mime='text/plain; charset=utf-8';
 }
 return {...value,mime,bytes,sha256:createHash('sha256').update(bytes).digest('hex')};
}
export async function addAttachment(store:Store,projectId:string,resultId:string,raw:unknown){
 const input=validateAttachment(raw);
 return store.transaction(async()=>{
  const result=await store.one('SELECT results.id FROM results JOIN runs ON results.run_id=runs.id WHERE results.id=? AND runs.project_id=?',resultId,projectId);
  if(!result)throw new DomainError(404,'Test result not found');
  const retry=input.retry??-1;
  if(retry!==-1&&!await store.one('SELECT id FROM automation_attempts WHERE result_id=? AND retry=?',resultId,retry))throw new DomainError(400,'Attachment retry does not match a recorded automation attempt.');
  const now=new Date().toISOString();
  await store.exec('DELETE FROM attachments WHERE expires_at<=?',now);
  const previous=await store.one(`SELECT ${attachmentColumns} FROM attachments WHERE result_id=? AND sha256=? AND filename=? AND kind=? AND retry=?`,resultId,input.sha256,input.filename,input.kind,retry);
  if(previous)return {...previous,replayed:true};
  const usage=await store.all('SELECT a.result_id,a.byte_size,r.project_id FROM attachments a JOIN results t ON a.result_id=t.id JOIN runs r ON t.run_id=r.id');
  const sum=(predicate:(r:any)=>boolean)=>usage.filter(predicate).reduce((n,r)=>n+Number(r.byte_size),0);
  if(usage.length>=2000||usage.filter(r=>r.project_id===projectId).length>=500||usage.filter(r=>r.result_id===resultId).length>=20||sum(r=>r.result_id===resultId)+input.bytes.length>20*1024*1024||sum(r=>r.project_id===projectId)+input.bytes.length>64*1024*1024||sum(()=>true)+input.bytes.length>128*1024*1024)throw new DomainError(409,'Attachment storage limit reached (20 files / 20 MiB per result, 64 MiB per project, 128 MiB per installation; 500 files per project / 2,000 overall).');
  const id=randomUUID(),expiry=new Date(Date.now()+30*86400000).toISOString();
  await store.exec('INSERT INTO attachments VALUES(?,?,?,?,?,?,?,?,?,?,?)',id,resultId,input.filename,input.kind,input.mime,input.bytes.length,input.sha256,retry,now,expiry,input.contentBase64);
  await store.event(projectId,'attachment.added',`${input.filename} · ${input.bytes.length} bytes · SHA-256 ${input.sha256}`);
  return {...await store.one(`SELECT ${attachmentColumns} FROM attachments WHERE id=?`,id),replayed:false};
 });
}
export async function listAttachments(store:Store,projectId:string,resultId:string){
 if(!await store.one('SELECT results.id FROM results JOIN runs ON results.run_id=runs.id WHERE results.id=? AND runs.project_id=?',resultId,projectId))throw new DomainError(404,'Test result not found');
 return store.all(`SELECT ${attachmentColumns} FROM attachments WHERE result_id=? AND expires_at>? ORDER BY created_at,id`,resultId,new Date().toISOString());
}
export async function readAttachment(store:Store,projectId:string,id:string){
 const a=await store.one('SELECT a.* FROM attachments a JOIN results t ON a.result_id=t.id JOIN runs r ON t.run_id=r.id WHERE a.id=? AND r.project_id=? AND a.expires_at>?',id,projectId,new Date().toISOString());
 if(!a)throw new DomainError(404,'Attachment not found or expired');
 return a;
}
