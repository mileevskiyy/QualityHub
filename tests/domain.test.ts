import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, type CaseInput } from '../server/store.ts';
const input: CaseInput = { title: 'Customer signs in', suite: 'Authentication', priority: 'high', preconditions: 'Account exists', steps: ['Enter credentials', 'Submit'], expected: 'Dashboard is visible' };
for (const database of [':memory:', 'pglite:']) {
    async function fixture() { const store = new Store(database); const project = (await store.createProject('Test project', '')); const c = (await store.createCase(project.id, input)); return { store, project, c }; }
    test(database + ' · ' + 'editing a case preserves history and the exact snapshot inside an existing run', async () => {
        const { store, project, c } = await fixture();
        try {
            const run = (await store.createRun(project.id, 'Release one', [c.id]));
            (await store.updateCase(project.id, c.id, 1, { ...input, title: 'Updated sign-in behavior', steps: ['New step'] }));
            assert.equal((await store.run(project.id, run.id)).results[0].snapshot.title, input.title);
            assert.equal((await store.run(project.id, run.id)).results[0].case_version, 1);
            assert.deepEqual((await store.history(project.id, c.id)).map((c) => c.version), [2, 1]);
            assert.equal((await store.cases(project.id))[0].title, 'Updated sign-in behavior');
        }
        finally {
            (await store.close());
        }
    });
    test(database + ' · ' + 'stale edits and stale result updates fail without overwriting newer data', async () => {
        const { store, project, c } = await fixture();
        try {
            (await store.updateCase(project.id, c.id, 1, { ...input, title: 'Newer content' }));
            await assert.rejects(async () => store.updateCase(project.id, c.id, 1, { ...input, title: 'Stale content' }), /has changed/);
            assert.equal((await store.cases(project.id))[0].title, 'Newer content');
            const run = (await store.createRun(project.id, 'Concurrency check', [c.id])), result = run.results[0];
            (await store.setResult(project.id, run.id, result.id, 'passed', '', 1));
            await assert.rejects(async () => store.setResult(project.id, run.id, result.id, 'failed', 'Old observation', 1), /has changed/);
            assert.equal((await store.run(project.id, run.id)).results[0].status, 'passed');
        }
        finally {
            (await store.close());
        }
    });
    test(database + ' · ' + 'a run cannot complete while untested, and becomes immutable on completion', async () => {
        const { store, project, c } = await fixture();
        try {
            const run = (await store.createRun(project.id, 'Release validation', [c.id])), r = run.results[0];
            await assert.rejects(async () => store.completeRun(project.id, run.id), /every test/);
            await assert.rejects(async () => store.setResult(project.id, run.id, r.id, 'failed', '', 1), /observation/);
            (await store.setResult(project.id, run.id, r.id, 'failed', 'Dashboard never appears', 1));
            assert.equal((await store.completeRun(project.id, run.id)).status, 'completed');
            await assert.rejects(async () => store.setResult(project.id, run.id, r.id, 'passed', '', 2), /read-only/);
        }
        finally {
            (await store.close());
        }
    });
    test(database + ' · ' + 'defects require failed results, prevent duplicate links, and cannot cross project boundaries', async () => {
        const { store, project, c } = await fixture();
        try {
            const other = (await store.createProject('Other project', '')), run = (await store.createRun(project.id, 'Defect validation', [c.id])), r = run.results[0];
            await assert.rejects(async () => store.createDefect(project.id, r.id, 'Sign-in broken', 'Reproduction details', 'high'), /failed or blocked/);
            (await store.setResult(project.id, run.id, r.id, 'failed', 'Dashboard missing', 1));
            await assert.rejects(async () => store.createDefect(other.id, r.id, 'Sign-in broken', 'Reproduction details', 'high'), /not found/);
            const defect = (await store.createDefect(project.id, r.id, 'Sign-in broken', 'Reproduction details', 'high'));
            await assert.rejects(async () => store.createDefect(project.id, r.id, 'Duplicate bug', 'Reproduction details', 'high'), /already linked/);
            assert.equal((await store.run(project.id, run.id)).results[0].defect_id, defect.id);
            (await store.setDefect(project.id, defect.id, 'resolved'));
            assert.equal((await store.defects(project.id))[0].status, 'resolved');
        }
        finally {
            (await store.close());
        }
    });
    test(database + ' · ' + 'archiving removes a case from the library but retains execution evidence', async () => {
        const { store, project, c } = await fixture();
        try {
            const run = (await store.createRun(project.id, 'Historical release', [c.id]));
            (await store.archiveCase(project.id, c.id, 1));
            assert.equal((await store.cases(project.id)).length, 0);
            assert.equal((await store.run(project.id, run.id)).results[0].snapshot.title, input.title);
            await assert.rejects(async () => store.createRun(project.id, 'Invalid new run', [c.id]), /active test cases/);
        }
        finally {
            (await store.close());
        }
    });
    test(database + ' · ' + 'run creation rolls back when given duplicate or foreign cases', async () => {
        const { store, project, c } = await fixture();
        try {
            await assert.rejects(async () => store.createRun(project.id, 'Duplicate selection', [c.id, c.id]));
            const other = (await store.createProject('Foreign project', '')), foreign = (await store.createCase(other.id, input));
            await assert.rejects(async () => store.createRun(project.id, 'Cross project', [c.id, foreign.id]));
            assert.equal((await store.runs(project.id)).length, 0);
        }
        finally {
            (await store.close());
        }
    });
    test(database + ' · ' + 'data survives closing and reopening a file-backed database', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'qualityhub-test-')), path = join(dir, 'db.sqlite');
        try {
            let store = new Store(path);
            const p = (await store.createProject('Persistent project', ''));
            (await store.createCase(p.id, input));
            (await store.close());
            store = new Store(path);
            assert.equal((await store.cases(p.id)).length, 1);
            (await store.close());
        }
        finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
    test(database + ' · ' + 'seeding is repeatable and demo results agree with dashboard totals', async () => {
        const store = new Store(database);
        try {
            (await store.seed());
            (await store.seed());
            assert.equal((await store.projects()).length, 1);
            const p = (await store.projects())[0];
            assert.equal((await store.cases(p.id)).length, 8);
            const seededRuns = await store.runs(p.id);
            assert.equal(seededRuns.length, 3);
            assert.equal(seededRuns.filter(r=>r.status==='completed').length, 2);
            const r = seededRuns.find(r=>r.name==='Storefront · smoke check')!;
            assert.equal(r.total, 8);
            assert.equal(r.passed, 4);
            assert.equal(r.failed, 1);
            assert.equal(r.untested, 3);
            assert.equal((await store.defects(p.id)).length, 1);
        }
        finally {
            (await store.close());
        }
    });
}
