import { compareSnapshots } from './comparison.ts';
import { Database } from './database.ts';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
export const caseInput = z.object({
    title: z.string().trim().min(3).max(180), suite: z.string().trim().min(1).max(80),
    priority: z.enum(['critical', 'high', 'medium', 'low']),
    preconditions: z.string().trim().max(4000).default(''),
    steps: z.array(z.string().trim().min(1).max(1000)).min(1).max(30),
    expected: z.string().trim().min(3).max(4000),
});
export type CaseInput = z.infer<typeof caseInput>;
export class DomainError extends Error {
    constructor(public status: number, message: string) { super(message); }
}
const id = () => randomUUID();
const now = () => new Date().toISOString();
export class Store {
    db: Database;
    constructor(path = ':memory:') {
        this.db = new Database(path);
        return new Proxy(this, { get: (target, key, receiver) => {
                const value = Reflect.get(target, key, receiver);
                if (typeof value !== 'function' || key === 'constructor')
                    return value;
                return (...args: any[]) => target.db.exclusive(() => value.apply(receiver, args));
            } });
    }
    async close() { await this.db.close(); }
    async all(sql: string, ...params: (string | number)[]): Promise<any[]> { return this.db.all(sql, params); }
    async one(sql: string, ...params: (string | number)[]): Promise<any> { return (await this.db.all(sql, params))[0]; }
    async exec(sql: string, ...params: (string | number | null)[]) { return this.db.exec(sql, params); }
    async transaction<T>(fn: () => Promise<T>): Promise<T> { return this.db.transaction(fn); }
    async requireProject(projectId: string) {
        const project = (await this.one('SELECT * FROM projects WHERE id=?', projectId));
        if (!project)
            throw new DomainError(404, 'Project not found');
        return project;
    }
    async event(projectId: string, action: string, detail: string) {
        (await this.exec('INSERT INTO events VALUES(?,?,?,?,?)', id(), projectId, action, detail, now()));
    }
    async projects() { return (await this.all('SELECT * FROM projects ORDER BY created_at ASC')); }
    async createProject(name: string, description: string) {
        return (await this.transaction(async () => {
            const projectId = id();
            (await this.exec('INSERT INTO projects VALUES(?,?,?,?)', projectId, name, description, now()));
            (await this.event(projectId, 'project.created', name));
            return (await this.requireProject(projectId));
        }));
    }
    async cases(projectId: string) {
        (await this.requireProject(projectId));
        return (await this.all('SELECT * FROM cases WHERE project_id=? AND archived=0 ORDER BY created_at', projectId)).map(row => ({ ...row, ...JSON.parse(row.payload), payload: undefined }));
    }
    async createCase(projectId: string, raw: unknown) {
        const input = caseInput.parse(raw);
        (await this.requireProject(projectId));
        return (await this.transaction(async () => {
            const caseId = id(), date = now(), payload = JSON.stringify(input);
            (await this.exec('INSERT INTO cases VALUES(?,?,1,?,0,?,?)', caseId, projectId, payload, date, date));
            (await this.exec('INSERT INTO case_versions VALUES(?,1,?,?)', caseId, payload, date));
            (await this.event(projectId, 'case.created', input.title));
            return { id: caseId, project_id: projectId, version: 1, ...input };
        }));
    }
    async updateCase(projectId: string, caseId: string, version: number, raw: unknown) {
        const input = caseInput.parse(raw);
        return (await this.transaction(async () => {
            const existing = (await this.one('SELECT * FROM cases WHERE id=? AND project_id=? AND archived=0', caseId, projectId));
            if (!existing)
                throw new DomainError(404, 'Test case not found');
            if (existing.version !== version)
                throw new DomainError(409, 'This test case has changed. Refresh before saving.');
            const date = now(), payload = JSON.stringify(input);
            (await this.exec('UPDATE cases SET version=version+1,payload=?,updated_at=? WHERE id=?', payload, date, caseId));
            (await this.exec('INSERT INTO case_versions VALUES(?,?,?,?)', caseId, version + 1, payload, date));
            (await this.event(projectId, 'case.updated', `${input.title} · version ${version + 1}`));
            return { id: caseId, project_id: projectId, version: version + 1, ...input };
        }));
    }
    async history(projectId: string, caseId: string) {
        if (!(await this.one('SELECT id FROM cases WHERE id=? AND project_id=?', caseId, projectId)))
            throw new DomainError(404, 'Test case not found');
        return (await this.all('SELECT * FROM case_versions WHERE case_id=? ORDER BY version DESC', caseId)).map(r => ({ ...r, ...JSON.parse(r.payload), payload: undefined }));
    }
    async archiveCase(projectId: string, caseId: string, version: number) {
        return (await this.transaction(async () => {
            const row = (await this.one('SELECT * FROM cases WHERE id=? AND project_id=? AND archived=0', caseId, projectId));
            if (!row)
                throw new DomainError(404, 'Test case not found');
            if (row.version !== version)
                throw new DomainError(409, 'This test case has changed. Refresh before archiving.');
            (await this.exec('UPDATE cases SET archived=1 WHERE id=?', caseId));
            (await this.event(projectId, 'case.archived', JSON.parse(row.payload).title));
            return { ok: true };
        }));
    }
    async runs(projectId: string) {
        (await this.requireProject(projectId));
        return (await this.all(`SELECT runs.*,COUNT(results.id) total,SUM(CASE WHEN results.status='passed' THEN 1 ELSE 0 END) passed,SUM(CASE WHEN results.status='failed' THEN 1 ELSE 0 END) failed,SUM(CASE WHEN results.status='blocked' THEN 1 ELSE 0 END) blocked,SUM(CASE WHEN results.status='untested' THEN 1 ELSE 0 END) untested FROM runs LEFT JOIN results ON runs.id=results.run_id WHERE runs.project_id=? GROUP BY runs.id ORDER BY runs.created_at DESC`, projectId));
    }
    async createRun(projectId: string, name: string, caseIds: string[]) {
        (await this.requireProject(projectId));
        return (await this.transaction(async () => {
            const cases = (await this.cases(projectId)).filter(c => caseIds.includes(c.id));
            if (cases.length !== caseIds.length || !cases.length)
                throw new DomainError(400, 'Select distinct active test cases from this project.');
            const runId = id(), date = now();
            (await this.exec('INSERT INTO runs VALUES(?,?,?,\'active\',?,NULL)', runId, projectId, name, date));
            for (const [position, c] of cases.entries())
                (await this.exec('INSERT INTO results(id,run_id,case_id,case_version,snapshot,status,note,updated_at,position) VALUES(?,?,?,?,?,\'untested\',\'\',?,?)', id(), runId, c.id, c.version, JSON.stringify(caseInput.parse(c)), date, position));
            (await this.event(projectId, 'run.created', `${name} · ${cases.length} test cases`));
            return (await this.run(projectId, runId));
        }));
    }
    async run(projectId: string, runId: string) {
        const run = (await this.one('SELECT * FROM runs WHERE id=? AND project_id=?', runId, projectId));
        if (!run)
            throw new DomainError(404, 'Test run not found');
        return { ...run, results: (await this.all('SELECT results.*,defects.id defect_id FROM results LEFT JOIN defects ON results.id=defects.result_id WHERE run_id=? ORDER BY results.position,results.id', runId)).map(r => ({ ...r, snapshot: JSON.parse(r.snapshot) })) };
    }
    async compareRuns(projectId: string, baselineId: string, candidateId: string) {
        if (baselineId === candidateId) throw new DomainError(400, 'Choose two different completed runs.');
        return this.transaction(async () => {
            const baseline = await this.run(projectId, baselineId), candidate = await this.run(projectId, candidateId);
            if (baseline.status !== 'completed' || candidate.status !== 'completed')
                throw new DomainError(409, 'Complete both runs before comparing their evidence.');
            const attempts = async (runId: string) => this.all('SELECT automation_attempts.* FROM automation_attempts JOIN results ON automation_attempts.result_id=results.id WHERE results.run_id=?', runId);
            return compareSnapshots(baseline, candidate, await attempts(baselineId), await attempts(candidateId));
        });
    }
    async setResult(projectId: string, runId: string, resultId: string, status: string, note: string, revision: number) {
        return (await this.transaction(async () => {
            const run = (await this.run(projectId, runId));
            if (run.status !== 'active')
                throw new DomainError(409, 'Completed runs are read-only. Create a new run to retest.');
            const result = run.results.find((r: any) => r.id === resultId);
            if (!result)
                throw new DomainError(404, 'Result not found');
            if (result.revision !== revision)
                throw new DomainError(409, 'This result has changed. Reload the run before saving.');
            if (['failed', 'blocked'].includes(status) && !note.trim())
                throw new DomainError(400, 'Add an observation for failed or blocked results.');
            (await this.exec('UPDATE results SET status=?,note=?,updated_at=?,revision=revision+1 WHERE id=?', status, note, now(), resultId));
            (await this.event(projectId, 'result.updated', `${result.snapshot.title} · ${status}`));
            return (await this.run(projectId, runId));
        }));
    }
    async completeRun(projectId: string, runId: string) {
        return (await this.transaction(async () => {
            const run = (await this.run(projectId, runId));
            if (run.status === 'completed')
                return run;
            if (run.results.some((r: any) => r.status === 'untested'))
                throw new DomainError(409, 'Record a result for every test before completing this run.');
            (await this.exec('UPDATE runs SET status=\'completed\',completed_at=? WHERE id=?', now(), runId));
            (await this.event(projectId, 'run.completed', run.name));
            return (await this.run(projectId, runId));
        }));
    }
    async createDefect(projectId: string, resultId: string, title: string, description: string, severity: string) {
        return (await this.transaction(async () => {
            const result = (await this.one('SELECT results.* FROM results JOIN runs ON results.run_id=runs.id WHERE results.id=? AND runs.project_id=?', resultId, projectId));
            if (!result)
                throw new DomainError(404, 'Result not found');
            if (!['failed', 'blocked'].includes(result.status))
                throw new DomainError(400, 'Defects must originate from a failed or blocked result.');
            if ((await this.one('SELECT id FROM defects WHERE result_id=?', resultId)))
                throw new DomainError(409, 'A defect is already linked to this result.');
            const defectId = id(), date = now();
            (await this.exec('INSERT INTO defects VALUES(?,?,?,?,?,?,\'open\',?,?)', defectId, projectId, resultId, title, description, severity, date, date));
            (await this.event(projectId, 'defect.created', title));
            return (await this.one('SELECT * FROM defects WHERE id=?', defectId));
        }));
    }
    async defects(projectId: string) {
        (await this.requireProject(projectId));
        return (await this.all('SELECT defects.*,results.run_id,results.case_id,results.case_version FROM defects JOIN results ON defects.result_id=results.id WHERE defects.project_id=? ORDER BY defects.created_at DESC', projectId));
    }
    async setDefect(projectId: string, defectId: string, status: string) {
        return (await this.transaction(async () => {
            const row = (await this.one('SELECT * FROM defects WHERE id=? AND project_id=?', defectId, projectId));
            if (!row)
                throw new DomainError(404, 'Defect not found');
            (await this.exec('UPDATE defects SET status=?,updated_at=? WHERE id=?', status, now(), defectId));
            (await this.event(projectId, 'defect.updated', `${row.title} · ${status}`));
            return (await this.one('SELECT * FROM defects WHERE id=?', defectId));
        }));
    }
    async activity(projectId: string) { (await this.requireProject(projectId)); return (await this.all('SELECT * FROM events WHERE project_id=? ORDER BY created_at DESC,id DESC LIMIT 60', projectId)); }
    async seed() {
        if ((await this.projects()).length)
            return;
        const project = (await this.createProject('Commerce web', 'Release confidence for the storefront. Demo data — not real customer results.'));
        const inputs: CaseInput[] = [
            { title: 'Customer can sign in with valid credentials', suite: 'Authentication', priority: 'critical', preconditions: 'An active customer account exists.', steps: ['Open the sign-in page.', 'Enter a valid email and password.', 'Select Sign in.'], expected: 'The customer sees their account dashboard.' },
            { title: 'Invalid password displays a helpful error', suite: 'Authentication', priority: 'high', preconditions: 'A registered customer exists.', steps: ['Open the sign-in page.', 'Enter a valid email with an incorrect password.', 'Submit the form.'], expected: 'An error is displayed and no session is created.' },
            { title: 'Cart persists after the customer signs back in', suite: 'Shopping cart', priority: 'critical', preconditions: 'Customer is signed in; a product is available.', steps: ['Add a product to the cart.', 'Sign out and sign back in.', 'Open the cart.'], expected: 'The original product and quantity are retained.' },
            { title: 'Order total updates when quantity changes', suite: 'Shopping cart', priority: 'high', preconditions: 'The cart contains a product.', steps: ['Open the cart.', 'Change quantity from one to two.', 'Review the subtotal.'], expected: 'The subtotal matches twice the unit price.' },
            { title: 'Checkout rejects an empty delivery address', suite: 'Checkout', priority: 'high', preconditions: 'A signed-in customer has a non-empty cart.', steps: ['Start checkout.', 'Leave the address empty.', 'Continue to payment.'], expected: 'Required fields are identified; payment does not start.' },
            { title: 'Product filters work on a mobile viewport', suite: 'Catalog', priority: 'medium', preconditions: 'Catalog has products in multiple categories.', steps: ['Open the catalog at a mobile viewport.', 'Choose a category filter.', 'Review the product list.'], expected: 'Only products from the chosen category are shown without horizontal overflow.' },
            { title: 'Guest cannot open the account dashboard', suite: 'Authentication', priority: 'critical', preconditions: 'No customer session is active.', steps: ['Open the account dashboard URL directly.'], expected: 'The guest is redirected to sign-in without exposing account information.' },
            { title: 'Out-of-stock product cannot be added to cart', suite: 'Catalog', priority: 'high', preconditions: 'A product has zero available stock.', steps: ['Open the product detail page.', 'Attempt to add the product to the cart.'], expected: 'The product cannot be added and stock status is clearly shown.' },
        ];
        const cases = [];
        for (const input of inputs)
            cases.push(await this.createCase(project.id, input));
        // Illustrative fixtures, not executions of an external storefront.
        for (const [offset, name, selection, statuses] of [
            [2000, 'Sample baseline · comparison', cases.slice(0, 6), ['passed','failed','passed','passed','passed','passed']],
            [1000, 'Sample candidate · comparison', [cases[0],cases[1],cases[2],cases[3],cases[4],cases[6]], ['failed','passed','blocked','passed','passed','passed']],
        ] as const) {
            const sample = await this.createRun(project.id, name, selection.map(c => c.id));
            for (const [i, result] of sample.results.entries())
                await this.setResult(project.id, sample.id, result.id, statuses[i], 'Illustrative sample outcome; not an external test execution.', 1);
            await this.completeRun(project.id, sample.id);
            await this.exec('UPDATE runs SET created_at=? WHERE id=?', new Date(Date.now()-offset).toISOString(), sample.id);
        }
        const run = (await this.createRun(project.id, 'Storefront · smoke check', cases.map(c => c.id)));
        for (const [i, r] of run.results.entries()) {
            if (i < 5)
                (await this.setResult(project.id, run.id, r.id, i === 2 ? 'failed' : 'passed', i === 2 ? 'Cart is empty after signing back in. Reproduced with a demo account in Chromium.' : '', 1));
        }
        (await this.createDefect(project.id, run.results[2].id, 'Cart contents disappear after signing back in', 'Steps: add a product, sign out, sign back in, then open the cart.\nExpected: product and quantity are retained.\nActual: cart is empty.\nEnvironment: demo storefront, Chromium.', 'high'));
    }
}
