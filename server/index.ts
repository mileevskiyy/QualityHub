import express from 'express';
import { mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Store } from './store.ts';
import { createApp } from './app.ts';
import { Auth } from './auth.ts';
import { randomBytes } from 'node:crypto';
const publicDemo=process.env.PUBLIC_DEMO==='true';
if(publicDemo&&process.env.DATABASE_URL)throw new Error('Public demo requires an isolated in-memory database; remove DATABASE_URL.');
if(!publicDemo&&process.env.NODE_ENV==='production'&&(process.env.SETUP_KEY||'').length<32)throw new Error('Production requires SETUP_KEY with at least 32 characters. Configure it in the hosting environment.');
if(!publicDemo&&process.env.NODE_ENV==='production'&&!process.env.DATABASE_URL)throw new Error('Production requires DATABASE_URL for persistent PostgreSQL storage.');
const dataPath = resolve(process.env.DATA_DIR || 'data');
mkdirSync(dataPath, { recursive: true });
const store = new Store(publicDemo?':memory:':process.env.DATABASE_URL || resolve(dataPath, 'qualityhub.sqlite'));
if (process.env.SEED_DEMO !== 'false') await store.seed();
else await store.projects();
const demoUser=publicDemo?await new Auth(store).register({name:'Demo operator',email:'demo@example.test',password:randomBytes(32).toString('hex'),setupKey:process.env.SETUP_KEY}):undefined;
const app = createApp(store,{demoUserId:demoUser?.id});
if (existsSync('dist')) {
  app.use(express.static(resolve('dist')));
  app.get('/{*path}', (_req, res) => res.sendFile(resolve('dist/index.html')));
}
const port = Number(process.env.PORT || 3100);
const host=process.env.HOST||'127.0.0.1';
const server = app.listen(port, host, () => console.log(`QualityHub: http://${host}:${port} · ${store.db.dialect} · authenticated workspace`));
for (const signal of ['SIGTERM','SIGINT']) process.on(signal, () => server.close(async () => { await store.close(); process.exit(0); }));
