import {addAttachment,listAttachments,readAttachment} from './attachments.ts';
import express from 'express';
import { z, ZodError } from 'zod';
import { Store, DomainError, caseInput } from './store.ts';
import { Auth, type Identity } from './auth.ts';
import { importRun } from './imports.ts';
const text = (min: number, max: number) => z.string().trim().min(min).max(max);
export function createApp(store: Store, options:{demoUserId?:string}={}) {
    if(options.demoUserId&&store.db.dialect!=='sqlite')throw new Error('Public demo cannot use PostgreSQL.');
    const app = express();
    const auth=new Auth(store);
    app.disable('x-powered-by');
    app.use((_req, res, next) => { res.set('X-Content-Type-Options', 'nosniff'); res.set('Cache-Control', 'no-store'); next(); });
    app.use((req, _res, next) => {
        // Local application: reject browser requests from other origins to prevent cross-site writes.
        const origin = req.get('origin');
        if (origin && !['http://127.0.0.1:5173', 'http://localhost:5173', 'http://127.0.0.1:3100', 'http://localhost:3100',process.env.APP_ORIGIN,process.env.RENDER_EXTERNAL_URL].filter(Boolean).includes(origin))
            return next(new DomainError(403, 'Origin not allowed'));
        next();
    });
    app.use(express.json({ limit: '8mb' }));
    app.get('/api/health', (_req, res) => res.json({ status: 'ok', mode: 'authenticated', database: store.db.dialect }));
    const attempts=new Map<string,{count:number;until:number}>();
    app.use('/api/auth',(req,_res,next)=>{
      if(req.method==='GET')return next();
      const key=req.ip||'local',time=Date.now();
      for(const [k,v] of attempts)if(v.until<time)attempts.delete(k);
      const entry=attempts.get(key)||{count:0,until:time+15*60000};entry.count++;attempts.set(key,entry);
      if(entry.count>30)return next(new DomainError(429,'Too many authentication attempts. Try again later.'));next();
    });
    app.get('/api/auth/status',async(_req,res)=>res.json({...await auth.status(),publicDemo:Boolean(options.demoUserId)}));
    const sessionCookie=(res:express.Response,value:string)=>res.cookie('qh_session',value,{httpOnly:true,sameSite:'strict',secure:process.env.NODE_ENV==='production',path:'/',maxAge:7*86400000});
    app.post('/api/auth/demo',async(_req,res,next)=>{if(!options.demoUserId)return next(new DomainError(404,'Demo mode is disabled.'));const session=await auth.session(options.demoUserId);sessionCookie(res,session.token);res.json({ok:true});});
    app.use('/api/auth',(req,_res,next)=>{if(options.demoUserId&&['/register','/login'].includes(req.path))return next(new DomainError(403,'Use the demo entry button.'));next();});
    app.post('/api/auth/register',async(req,res)=>{const user=await auth.register(req.body),session=await auth.session(user.id);sessionCookie(res,session.token);res.status(201).json({ok:true});});
    app.post('/api/auth/login',async(req,res)=>{const b=z.object({email:z.string().email().max(254),password:z.string().min(1).max(200)}).parse(req.body);const session=await auth.login(b.email,b.password);sessionCookie(res,session.token);res.json({ok:true});});
    app.use('/api',async(req,res,next)=>{
      const match=/^qh_session=([^;]+)/.exec((req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('qh_session='))||'');
      const user=await auth.identify(match?.[1]);
      if(user)res.locals.user=user;
      // Import bearer tokens are checked by the dedicated endpoint, not accepted as interactive sessions.
      if(!user&&!(req.method==='POST'&&/^\/projects\/[^/]+\/imports\/playwright(?:\/attachments)?$/.test(req.path)&&req.get('authorization')?.startsWith('Bearer ')))throw new DomainError(401,'Sign in to continue.');
      if(user&&!['GET','HEAD'].includes(req.method)&&req.get('x-csrf-token')!==user.csrf)throw new DomainError(403,'Session verification failed. Reload and try again.');
      next();
    });
    app.get('/api/auth/me',(_req,res)=>{const {id,name,email,csrf}=res.locals.user as Identity;res.json({id,name,email,csrf});});
    app.post('/api/auth/logout',async(_req,res)=>{await auth.logout(res.locals.user);res.clearCookie('qh_session',{path:'/'});res.json({ok:true});});
    app.use('/api/projects/:p',async(req,res,next)=>{
      const bearer=req.get('authorization');
      if(req.method==='POST'&&['/imports/playwright','/imports/playwright/attachments'].includes(req.path)&&bearer?.startsWith('Bearer ')){
        if(!await auth.tokenIdentity(bearer.slice(7),req.params.p))throw new DomainError(401,'Invalid or revoked integration token.');
      }else{await auth.role(res.locals.user.id,req.params.p,['GET','HEAD'].includes(req.method)?'read':'write');}
      next();
    });
    app.get('/api/projects', async (_req, res) => res.json(await auth.projects(res.locals.user.id)));
    app.post('/api/projects', async (req, res) => { const b = z.object({ name: text(3, 100), description: text(0, 2000).default('') }).parse(req.body); res.status(201).json(await auth.createProject(res.locals.user.id,b.name,b.description)); });
    app.get('/api/projects/:p/members',async(req,res)=>res.json(await auth.members(req.params.p)));
    app.patch('/api/projects/:p/members/:u',async(req,res)=>{await auth.role(res.locals.user.id,req.params.p,'owner');const b=z.object({role:z.enum(['owner','tester','viewer']).nullable()}).parse(req.body);await auth.changeMember(req.params.p,req.params.u,b.role);res.json({ok:true});});
    app.post('/api/projects/:p/invitations',async(req,res)=>{await auth.role(res.locals.user.id,req.params.p,'owner');const b=z.object({email:z.string().email().max(254).transform(s=>s.toLowerCase()),role:z.enum(['tester','viewer'])}).parse(req.body);res.status(201).json(await auth.invite(req.params.p,b.email,b.role));});
    app.get('/api/projects/:p/tokens',async(req,res)=>{await auth.role(res.locals.user.id,req.params.p,'owner');res.json(await auth.tokens(req.params.p));});
    app.post('/api/projects/:p/tokens',async(req,res)=>{await auth.role(res.locals.user.id,req.params.p,'owner');const b=z.object({name:text(3,80)}).parse(req.body);res.status(201).json(await auth.token(req.params.p,b.name));});
    app.delete('/api/projects/:p/tokens/:t',async(req,res)=>{await auth.role(res.locals.user.id,req.params.p,'owner');await auth.revoke(req.params.p,req.params.t);res.json({ok:true});});
    app.post('/api/projects/:p/imports/playwright',async(req,res)=>res.status(201).json(await importRun(store,req.params.p,req.body)));
    app.post('/api/projects/:p/imports/playwright/attachments',async(req,res)=>{
      const b=z.object({runExternalId:z.string().min(3).max(180),testExternalId:z.string().min(1).max(300),retry:z.number().int().min(0).max(20)}).parse(req.body);
      const result=await store.one('SELECT t.id FROM imports i JOIN results t ON t.run_id=i.run_id JOIN external_cases c ON c.case_id=t.case_id AND c.project_id=i.project_id WHERE i.project_id=? AND i.external_id=? AND c.external_id=?',req.params.p,b.runExternalId,b.testExternalId);
      if(!result)throw new DomainError(404,'Imported test result not found');
      res.status(201).json(await addAttachment(store,req.params.p,result.id,req.body));
    });
    app.get('/api/projects/:p/results/:id/attachments',async(req,res)=>res.json(await listAttachments(store,req.params.p,req.params.id)));
    app.post('/api/projects/:p/results/:id/attachments',async(req,res)=>res.status(201).json(await addAttachment(store,req.params.p,req.params.id,req.body)));
    app.get('/api/projects/:p/attachments/:id',async(req,res)=>{
      const a=await readAttachment(store,req.params.p,req.params.id);
      res.set('Content-Type',a.mime);res.set('Content-Security-Policy',"sandbox; default-src 'none'");
      res.set('Content-Disposition',`attachment; filename="evidence"; filename*=UTF-8''${encodeURIComponent(a.filename)}`);
      res.send(Buffer.from(a.content_base64,'base64'));
    });
    app.get('/api/projects/:p/cases', async (req, res) => res.json((await store.cases(req.params.p))));
    app.post('/api/projects/:p/cases', async (req, res) => res.status(201).json((await store.createCase(req.params.p, req.body))));
    app.put('/api/projects/:p/cases/:c', async (req, res) => { const b = caseInput.extend({ version: z.number().int().positive() }).parse(req.body); res.json((await store.updateCase(req.params.p, req.params.c, b.version, b))); });
    app.get('/api/projects/:p/cases/:c/history', async (req, res) => res.json((await store.history(req.params.p, req.params.c))));
    app.post('/api/projects/:p/cases/:c/archive', async (req, res) => { const b = z.object({ version: z.number().int().positive() }).parse(req.body); res.json((await store.archiveCase(req.params.p, req.params.c, b.version))); });
    app.get('/api/projects/:p/runs', async (req, res) => res.json((await store.runs(req.params.p))));
    app.post('/api/projects/:p/runs', async (req, res) => { const b = z.object({ name: text(3, 140), caseIds: z.array(z.string().uuid()).min(1).max(500) }).parse(req.body); res.status(201).json((await store.createRun(req.params.p, b.name, b.caseIds))); });
    app.get('/api/projects/:p/runs/compare', async (req, res) => {
        const q = z.object({ baseline: z.string().uuid(), candidate: z.string().uuid() }).parse(req.query);
        res.json(await store.compareRuns(req.params.p, q.baseline, q.candidate));
    });
    app.get('/api/projects/:p/runs/:r', async (req, res) => res.json((await store.run(req.params.p, req.params.r))));
    app.get('/api/projects/:p/runs/:r/attempts',async(req,res)=>{await store.run(req.params.p,req.params.r);res.json(await store.all('SELECT automation_attempts.* FROM automation_attempts JOIN results ON automation_attempts.result_id=results.id WHERE results.run_id=? ORDER BY results.position,automation_attempts.retry',req.params.r));});
    app.patch('/api/projects/:p/runs/:r/results/:id', async (req, res) => { const b = z.object({ status: z.enum(['untested', 'passed', 'failed', 'blocked', 'skipped']), note: text(0, 8000), revision: z.number().int().positive() }).parse(req.body); res.json((await store.setResult(req.params.p, req.params.r, req.params.id, b.status, b.note, b.revision))); });
    app.post('/api/projects/:p/runs/:r/complete', async (req, res) => res.json((await store.completeRun(req.params.p, req.params.r))));
    app.get('/api/projects/:p/defects', async (req, res) => res.json((await store.defects(req.params.p))));
    app.post('/api/projects/:p/defects', async (req, res) => { const b = z.object({ resultId: z.string().uuid(), title: text(3, 180), description: text(10, 8000), severity: z.enum(['critical', 'high', 'medium', 'low']) }).parse(req.body); res.status(201).json((await store.createDefect(req.params.p, b.resultId, b.title, b.description, b.severity))); });
    app.patch('/api/projects/:p/defects/:d', async (req, res) => { const b = z.object({ status: z.enum(['open', 'in_progress', 'resolved']) }).parse(req.body); res.json((await store.setDefect(req.params.p, req.params.d, b.status))); });
    app.get('/api/projects/:p/activity', async (req, res) => res.json((await store.activity(req.params.p))));
    app.get('/api/projects/:p/export', async (req, res) => {
        const project = (await store.requireProject(req.params.p));
        res.setHeader('Content-Disposition', 'attachment; filename="qualityhub-export.json"');
        const attachments=await store.all('SELECT a.id,a.result_id,a.filename,a.kind,a.mime,a.byte_size,a.sha256,a.retry,a.created_at,a.expires_at FROM attachments a JOIN results t ON a.result_id=t.id JOIN runs r ON t.run_id=r.id WHERE r.project_id=? AND a.expires_at>?',project.id,new Date().toISOString());
        res.json({ attachments, schemaVersion: 2, exportedAt: new Date().toISOString(), project, cases: (await store.cases(project.id)), runs: await Promise.all((await store.runs(project.id)).map(r => store.run(project.id, r.id))), defects: (await store.defects(project.id)) });
    });
    app.use('/api', (_req, res) => res.status(404).json({ error: 'Endpoint not found' }));
    app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
        if (error instanceof ZodError)
            return res.status(400).json({ error: error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') });
        if (error instanceof DomainError)
            return res.status(error.status).json({ error: error.message });
        if (error.type === 'entity.parse.failed')
            return res.status(400).json({ error: 'Invalid JSON body' });
        if (error.type === 'entity.too.large')
            return res.status(413).json({ error: 'Request body is too large' });
        console.error('Request failed:', error.message);
        res.status(500).json({ error: 'Unexpected server error' });
    });
    return app;
}
