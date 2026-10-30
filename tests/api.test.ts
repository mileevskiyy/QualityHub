import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {Store} from '../server/store.ts';
import {createApp} from '../server/app.ts';

test('authenticated HTTP workflow, CSRF, project isolation and role enforcement',async()=>{
 const store=new Store(),server=createApp(store).listen(0,'127.0.0.1');await once(server,'listening');
 const base=`http://127.0.0.1:${(server.address() as any).port}/api`;
 let cookie='',csrf='';
 async function req(path:string,method='GET',body?:unknown,headers:Record<string,string>={}){return fetch(base+path,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...(csrf?{'X-CSRF-Token':csrf}:{}),...headers},body:body?JSON.stringify(body):undefined});}
 async function register(email:string,invite?:string){const r=await req('/auth/register','POST',{name:email.split('@')[0],email,password:'Synthetic-password-123!',invite});assert.equal(r.status,201);cookie=r.headers.get('set-cookie')!.split(';')[0];csrf=(await(await req('/auth/me')).json()).csrf;}
 try{
  assert.equal((await req('/projects')).status,401);
  assert.equal((await req('/auth/status')).status,200);
  await register('owner@example.test');
  const ownerCookie=cookie,ownerCsrf=csrf;
  assert.equal((await req('/projects','POST',{name:'x'})).status,400);
  assert.equal((await req('/projects','POST',{name:'Blocked origin'},{Origin:'https://untrusted.example'})).status,403);
  assert.equal((await req('/projects','POST',{name:'Missing CSRF'},{'X-CSRF-Token':''})).status,403);
  const p=await(await req('/projects','POST',{name:'API project'})).json();
  const c=await(await req(`/projects/${p.id}/cases`,'POST',{title:'Checkout completes',suite:'Checkout',priority:'high',steps:['Submit order'],expected:'Order confirmation appears'})).json();assert.ok(c.id);
  const run=await(await req(`/projects/${p.id}/runs`,'POST',{name:'API workflow',caseIds:[c.id]})).json(),result=run.results[0];
  assert.equal((await req(`/projects/${p.id}/runs/${run.id}/results/${result.id}`,'PATCH',{status:'failed',note:'Server returned error',revision:1})).status,200);
  assert.equal((await req(`/projects/${p.id}/defects`,'POST',{resultId:result.id,title:'Checkout returns error',description:'Submit order; the server returns an error instead of confirmation.',severity:'high'})).status,201);
  const data=await(await req(`/projects/${p.id}/export`)).json();assert.equal(data.schemaVersion,2);assert.equal(data.runs[0].results[0].status,'failed');
  const invitation=await(await req(`/projects/${p.id}/invitations`,'POST',{email:'viewer@example.test',role:'viewer'})).json();
  cookie='';csrf='';await register('viewer@example.test',invitation.invite);
  assert.equal((await req(`/projects/${p.id}/cases`)).status,200);
  assert.equal((await req(`/projects/${p.id}/cases`,'POST',{})).status,403);
  assert.equal((await req(`/projects/${p.id}/tokens`)).status,403);
  const viewerCookie=cookie,viewerCsrf=csrf;
  cookie=ownerCookie;csrf=ownerCsrf;
  const other=await(await req('/projects','POST',{name:'Private owner project'})).json();
  cookie=viewerCookie;csrf=viewerCsrf;assert.equal((await req(`/projects/${other.id}/export`)).status,404);
  assert.equal((await req('/auth/logout','POST')).status,200);assert.equal((await req('/auth/me')).status,401);
  cookie='';csrf='';assert.equal((await req('/auth/login','POST',{email:'viewer@example.test',password:'incorrect'})).status,401);
  const login=await req('/auth/login','POST',{email:'viewer@example.test',password:'Synthetic-password-123!'});assert.equal(login.status,200);
  cookie=login.headers.get('set-cookie')!.split(';')[0];assert.ok((await(await req('/auth/me')).json()).csrf);
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));await store.close();}
});
