import { DatabaseSync } from 'node:sqlite';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Pool, type PoolClient } from 'pg';
import { schema, collaborationSchema, attachmentSchema } from './schema.ts';

export class Database {
  private sqlite?: DatabaseSync;
  private pg?: Pool;
  private pglite?: any;
  private context = new AsyncLocalStorage<{ client?: PoolClient; nested: boolean; transaction?: boolean }>();
  private tail: Promise<unknown> = Promise.resolve();
  private ready: Promise<void>;
  readonly dialect: 'sqlite'|'postgres';
  constructor(path: string) {
    this.dialect = /^(postgres(ql)?:|pglite:)/.test(path) ? 'postgres' : 'sqlite';
    this.ready=this.initialize(path);
  }
  private async initialize(path: string) {
    if(path.startsWith('pglite:')) {
      const { PGlite } = await import('@electric-sql/pglite');
      this.pglite=new PGlite(); await this.pglite.exec(schema+collaborationSchema);
    } else if(this.dialect==='postgres') {
      this.pg=new Pool({connectionString:path,max:5});
      await this.pg.query(schema+collaborationSchema);
    } else {
      this.sqlite=new DatabaseSync(path);
      this.sqlite.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
      this.sqlite.exec(schema+collaborationSchema);
    }
    if(this.sqlite)this.sqlite.exec(attachmentSchema);
    else if(this.pglite)await this.pglite.exec(attachmentSchema);
    else await this.pg!.query(attachmentSchema);
    await this.exec('INSERT INTO schema_migrations(version,applied_at) VALUES(3,?) ON CONFLICT(version) DO NOTHING',[new Date().toISOString()]);
    if(!(await this.all('SELECT version FROM schema_migrations WHERE version=2')).length){
      await this.exec('ALTER TABLE results ADD COLUMN position INTEGER NOT NULL DEFAULT 0');
      await this.exec('INSERT INTO schema_migrations VALUES(2,?)',[new Date().toISOString()]);
    }
  }
  async exclusive<T>(fn:()=>Promise<T>):Promise<T> {
    await this.ready;
    if(this.context.getStore()) return fn();
    const task=this.tail.then(()=>this.context.run({nested:true},fn));
    this.tail=task.catch(()=>{});return task;
  }
  private parameters(sql:string){let n=0;return sql.replace(/\?/g,()=>`$${++n}`);}
  async all(sql:string,params:(string|number|null)[]=[]):Promise<any[]> {
    if(this.sqlite)return this.sqlite.prepare(sql).all(...params);
    const query=this.parameters(sql);
    if(this.pglite)return (await this.pglite.query(query,params)).rows;
    const client=this.context.getStore()?.client||this.pg!;
    const result=await client.query(query,params);
    return result.rows.map(row=>Object.fromEntries(Object.entries(row).map(([k,v])=>['total','passed','failed','blocked','untested'].includes(k)&&typeof v==='string'?[k,Number(v)]:[k,v])));
  }
  async exec(sql:string,params:(string|number|null)[]=[]):Promise<void>{await this.all(sql,params);}
  async transaction<T>(fn:()=>Promise<T>):Promise<T>{
    if(this.context.getStore()?.transaction)return fn();
    if(this.sqlite||this.pglite){
      await this.exec(this.sqlite?'BEGIN IMMEDIATE':'BEGIN');
      try{const result=await this.context.run({nested:true,transaction:true},fn);await this.exec('COMMIT');return result;}catch(e){await this.exec('ROLLBACK');throw e;}
    }
    const client=await this.pg!.connect();
    try{
      await client.query('BEGIN');
      // Serialize writes across processes until row-level locking is introduced.
      await client.query('SELECT pg_advisory_xact_lock(72901401)');
      const result=await this.context.run({nested:true,client,transaction:true},fn);
      await client.query('COMMIT');return result;
    }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  }
  async close(){await this.ready;if(this.sqlite)this.sqlite.close();if(this.pg)await this.pg.end();if(this.pglite)await this.pglite.close();}
}
