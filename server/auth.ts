import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { z } from 'zod';
import { Store, DomainError } from './store.ts';
const scrypt=promisify(scryptCallback);
export const registration=z.object({name:z.string().trim().min(2).max(80),email:z.string().trim().email().max(254).transform(s=>s.toLowerCase()),password:z.string().min(12).max(200),invite:z.string().max(200).optional()});
export type Role='owner'|'tester'|'viewer';
export interface Identity {id:string;name:string;email:string;csrf:string;sessionHash:string}
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
const token=()=>randomBytes(32).toString('hex');
export class Auth {
 constructor(private store:Store){}
 async status(){return {needsSetup:!(await this.store.one('SELECT id FROM users LIMIT 1'))};}
 async register(raw:unknown){
  const b=registration.parse(raw),salt=randomBytes(16).toString('hex'),hash=(await scrypt(b.password,salt,64) as Buffer).toString('hex');
  return this.store.transaction(async()=>{
   const first=!(await this.store.one('SELECT id FROM users LIMIT 1'));
   const invite=b.invite?await this.store.one('SELECT * FROM invitations WHERE token_hash=? AND used_at IS NULL AND expires_at>?',digest(b.invite),new Date().toISOString()):undefined;
   if(!first&&(!invite||invite.email!==b.email))throw new DomainError(403,'A valid invitation for this email address is required.');
   if(await this.store.one('SELECT id FROM users WHERE email=?',b.email))throw new DomainError(409,'An account with this email already exists.');
   const id=randomUUID();await this.store.exec('INSERT INTO users VALUES(?,?,?,?,?,?)',id,b.name,b.email,salt,hash,new Date().toISOString());
   if(first){for(const p of await this.store.projects())await this.store.exec('INSERT INTO memberships VALUES(?,?,?)',p.id,id,'owner');}
   if(invite){await this.store.exec('INSERT INTO memberships VALUES(?,?,?)',invite.project_id,id,invite.role);await this.store.exec('UPDATE invitations SET used_at=? WHERE id=?',new Date().toISOString(),invite.id);}
   return {id,name:b.name,email:b.email};
  });
 }
 async login(email:string,password:string){
  const u=await this.store.one('SELECT * FROM users WHERE email=?',email.toLowerCase().trim());
  const hash=await scrypt(password,u?.salt||'00000000000000000000000000000000',64) as Buffer;
  if(!u||!timingSafeEqual(hash,Buffer.from(u.password_hash,'hex')))throw new DomainError(401,'Incorrect email or password.');
  return this.session(u.id);
 }
 async session(userId:string){
  const value=token(),csrf=token(),expires=new Date(Date.now()+7*86400000).toISOString();
  await this.store.exec('DELETE FROM sessions WHERE expires_at<?',new Date().toISOString());
  await this.store.exec('INSERT INTO sessions VALUES(?,?,?,?,?)',digest(value),userId,csrf,expires,new Date().toISOString());
  return {token:value,expires};
 }
 async identify(value?:string):Promise<Identity|null>{
  if(!value)return null;
  const row=await this.store.one('SELECT users.id,users.name,users.email,sessions.csrf FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.token_hash=? AND sessions.expires_at>?',digest(value),new Date().toISOString());
  return row?{...row,sessionHash:digest(value)}:null;
 }
 async logout(identity:Identity){await this.store.exec('DELETE FROM sessions WHERE token_hash=?',identity.sessionHash);}
 async role(userId:string,projectId:string,minimum:'read'|'write'|'owner'='read'):Promise<Role>{
  const member=await this.store.one('SELECT role FROM memberships WHERE project_id=? AND user_id=?',projectId,userId);
  if(!member)throw new DomainError(404,'Project not found');
  if(minimum==='owner'&&member.role!=='owner'||minimum==='write'&&member.role==='viewer')throw new DomainError(403,'Your project role does not allow this action.');
  return member.role;
 }
 async projects(userId:string){return this.store.all('SELECT projects.*,memberships.role FROM projects JOIN memberships ON projects.id=memberships.project_id WHERE memberships.user_id=? ORDER BY projects.created_at',userId);}
 async createProject(userId:string,name:string,description:string){
  // createProject already starts a transaction; keep membership in that same transaction via a dedicated operation.
  return this.store.transaction(async()=>{const id=randomUUID(),date=new Date().toISOString();await this.store.exec('INSERT INTO projects VALUES(?,?,?,?)',id,name,description,date);await this.store.exec('INSERT INTO memberships VALUES(?,?,?)',id,userId,'owner');await this.store.event(id,'project.created',name);return {...await this.store.requireProject(id),role:'owner'};});
 }
 async invite(projectId:string,email:string,role:'tester'|'viewer'){
  return this.store.transaction(async()=>{
   const existing=await this.store.one('SELECT id FROM users WHERE email=?',email);
   if(existing){if(await this.store.one('SELECT role FROM memberships WHERE project_id=? AND user_id=?',projectId,existing.id))throw new DomainError(409,'This user already has access.');await this.store.exec('INSERT INTO memberships VALUES(?,?,?)',projectId,existing.id,role);await this.store.event(projectId,'member.added',`${email} · ${role}`);return {added:true};}
   const value=token(),expires=new Date(Date.now()+48*3600000).toISOString();
   await this.store.exec('INSERT INTO invitations VALUES(?,?,?,?,?,?,NULL)',randomUUID(),projectId,email,role,digest(value),expires);
   await this.store.event(projectId,'invitation.created',`${email} · ${role}`);
   return {invite:value,expires};
  });
 }
 async members(projectId:string){return this.store.all('SELECT users.id,users.name,users.email,memberships.role FROM memberships JOIN users ON users.id=memberships.user_id WHERE project_id=? ORDER BY users.name',projectId);}
 async changeMember(projectId:string,userId:string,role:Role|null){
  return this.store.transaction(async()=>{
   const current=await this.store.one('SELECT role FROM memberships WHERE project_id=? AND user_id=?',projectId,userId);
   if(!current)throw new DomainError(404,'Member not found.');
   if(current.role==='owner'&&role!=='owner'&&(await this.store.all("SELECT user_id FROM memberships WHERE project_id=? AND role='owner'",projectId)).length===1)throw new DomainError(409,'A project must retain at least one owner.');
   if(role)await this.store.exec('UPDATE memberships SET role=? WHERE project_id=? AND user_id=?',role,projectId,userId);
   else await this.store.exec('DELETE FROM memberships WHERE project_id=? AND user_id=?',projectId,userId);
   await this.store.event(projectId,role?'member.role_changed':'member.removed',`${userId} · ${role||'access removed'}`);
  });
 }
 async token(projectId:string,name:string){const value=`qh_${token()}`;await this.store.exec('INSERT INTO api_tokens VALUES(?,?,?,?,?,NULL)',randomUUID(),projectId,name,digest(value),new Date().toISOString());return {token:value};}
 async tokenIdentity(value:string,projectId:string){return this.store.one('SELECT id FROM api_tokens WHERE token_hash=? AND project_id=? AND revoked_at IS NULL',digest(value),projectId);}
 async tokens(projectId:string){return this.store.all('SELECT id,name,created_at,revoked_at FROM api_tokens WHERE project_id=? ORDER BY created_at DESC',projectId);}
 async revoke(projectId:string,id:string){await this.store.exec('UPDATE api_tokens SET revoked_at=? WHERE id=? AND project_id=?',new Date().toISOString(),id,projectId);}
}
