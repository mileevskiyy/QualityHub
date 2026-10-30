# Verification record

Release 0.2, checked on 30 October 2026 with Node.js 24.17.0.

## Executed automated checks

- `npm test`: **22 passed, 1 skipped, 0 failed**.
- `npm run build`: strict TypeScript checks and Vite production build passed.
- Dependency installation audit: **0 reported known vulnerabilities** at the time of verification.

The executed checks cover SQLite and an embedded PostgreSQL engine through PGlite. They verify historical snapshots, case-version retention, stale-write rejection, run completion rules, immutable completed results, defect lineage, project boundaries, archival retention, transaction rollback, persistence and repeatable demo initialization.

Collaboration checks cover invitation-bound accounts, session invalidation, read/write/admin roles, last-owner protection and scoped/revoked integration tokens. Import tests cover final outcome mapping, retry retention, identical replays, changed-payload conflicts and concurrent duplicate delivery.

A reporter integration test instantiates the custom Playwright reporter, writes a local report and sends it to a real local HTTP API using a project token. It verifies persisted attempts, duplicate-delivery behavior and rejection after token revocation. This is an integration test of the reporting pipeline, not a browser execution.

## Executed browser checks

Against an isolated local database with fictional accounts and records:

1. Signed in through the interface using an existing synthetic account.
2. Inspected the authenticated project dashboard and membership/role controls.
3. Imported a report containing a failed attempt followed by a successful retry.
4. Re-sent the same report and confirmed that the interface reported an existing import rather than creating another run.
5. Reloaded the application and confirmed persisted state and session continuity.
6. Captured the updated interface screenshot included in this directory.

The previous release's complete browser case/run/defect workflow is additionally represented by the maintained Playwright end-to-end test.

## Explicit verification limits

The standalone PostgreSQL wire-driver test was skipped locally because `TEST_POSTGRES_URL` was not configured. PGlite coverage does not verify a remote PostgreSQL connection, TLS configuration or a hosted database. GitHub Actions is configured to run that driver test with a PostgreSQL service after the repository is uploaded; no remote CI result is claimed here.

The CLI Chromium suite and Docker Compose stack were not executed in this environment. The browser interactions listed above were performed against the running application. No public deployment, load benchmark, external user adoption or completed security audit is claimed.
