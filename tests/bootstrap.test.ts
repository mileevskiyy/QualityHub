import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../server/store.ts';
import { Auth } from '../server/auth.ts';

test('first-owner registration requires setup key, while later invitations do not',async()=>{
 const previous=process.env.SETUP_KEY;process.env.SETUP_KEY='Synthetic-setup-key-for-tests-123456789';
 const store=new Store(),auth=new Auth(store);
 const owner={name:'Owner',email:'owner@example.test',password:'Synthetic-password-123!'};
 try{
  assert.deepEqual(await auth.status(),{needsSetup:true,setupKeyRequired:true});
  await assert.rejects(()=>auth.register(owner),/setup key/);
  await assert.rejects(()=>auth.register({...owner,setupKey:'wrong'}),/setup key/);
  assert.equal((await store.all('SELECT id FROM users')).length,0);
  const u=await auth.register({...owner,setupKey:process.env.SETUP_KEY});
  assert.deepEqual(await auth.status(),{needsSetup:false,setupKeyRequired:false});
  const project=await auth.createProject(u.id,'Hosted project','');
  const invitation=await auth.invite(project.id,'viewer@example.test','viewer');
  const viewer=await auth.register({name:'Viewer',email:'viewer@example.test',password:'Synthetic-password-123!',invite:invitation.invite});
  assert.equal(await auth.role(viewer.id,project.id),'viewer');
 }finally{await store.close();if(previous===undefined)delete process.env.SETUP_KEY;else process.env.SETUP_KEY=previous;}
});
