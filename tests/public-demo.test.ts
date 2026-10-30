import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {Store} from '../server/store.ts';
import {Auth} from '../server/auth.ts';
import {createApp} from '../server/app.ts';
test('public demo session accesses seeded projects while writes require CSRF',async()=>{
 const store=new Store();await store.seed();
 const user=await new Auth(store).register({name:'Demo operator',email:'demo@example.test',password:'Synthetic-demo-password'});
 const server=createApp(store,{demoUserId:user.id}).listen(0,'127.0.0.1');await once(server,'listening');
 const base=`http://127.0.0.1:${(server.address() as any).port}/api`;
 try{
  assert.equal((await(await fetch(base+'/auth/status')).json()).publicDemo,true);
  assert.equal((await fetch(base+'/auth/demo',{method:'POST',headers:{Origin:'https://untrusted.example'}})).status,403);
  const login=await fetch(base+'/auth/demo',{method:'POST'});assert.equal(login.status,200);
  const Cookie=login.headers.get('set-cookie')!.split(';')[0];
  const identity=await(await fetch(base+'/auth/me',{headers:{Cookie}})).json();
  const projects=await(await fetch(base+'/projects',{headers:{Cookie}})).json();assert.equal(projects[0].name,'Commerce web');
  assert.equal((await fetch(base+'/projects',{method:'POST',headers:{Cookie,'Content-Type':'application/json'},body:JSON.stringify({name:'Visitor project'})})).status,403);
  assert.equal((await fetch(base+'/projects',{method:'POST',headers:{Cookie,'Content-Type':'application/json','X-CSRF-Token':identity.csrf},body:JSON.stringify({name:'Visitor project'})})).status,201);
  assert.equal((await fetch(base+'/auth/register',{method:'POST'})).status,403);
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));await store.close();}
});
test('ordinary workspace does not expose demo login',async()=>{
 const store=new Store(),server=createApp(store).listen(0,'127.0.0.1');await once(server,'listening');
 try{assert.equal((await fetch(`http://127.0.0.1:${(server.address() as any).port}/api/auth/demo`,{method:'POST'})).status,404);}
 finally{await new Promise<void>(resolve=>server.close(()=>resolve()));await store.close();}
});
