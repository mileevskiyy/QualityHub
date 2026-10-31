# Verification record

## Execution evidence upgrade — 31 October 2026

Application commit `3b5d2ab`: GitHub Actions passed, including PostgreSQL wire-driver evidence checks (36 server tests, no skips). Render public deployment `dep-dbitm23bc2fs73cr8mag` reached `live`. All three public browser scenarios passed against `https://qualityhub-public-demo.onrender.com/`, including screenshot preview, exact log download and real trace upload.

- `npm test`: **35 passed, 1 skipped, 0 failed** locally (SQLite and PGlite). Real PostgreSQL wire coverage is maintained for CI and not claimed as locally executed.
- `npm run build`: passed.
- `npm run test:e2e`: **1 passed**, including linked-defect access after the evidence UI was added.
- Demo browser suite: **3 passed**. The new scenario uploads an actual browser screenshot, UTF-8 log and a real Playwright-generated trace, checks exact downloaded bytes and stored screenshot SHA-256, previews an image, reopens evidence and checks mobile overflow.
- Reporter integration collects a log from disk and a ZIP fixture, writes local report bytes, uploads both against a real local HTTP API and replays delivery without duplication.
- Store checks cover result/project isolation, immutable completed outcomes, matching retry requirements, retention expiry/pruning, quota rejection and rollback when the audit write fails, on both database engines.
- HTTP checks cover viewer download/write denial, cross-project denial, write-token download denial and restrictive download headers.
- Validation checks cover path-like filenames, malformed base64, unsupported screenshot bytes, invalid ZIP signatures, binary logs and oversize content.
- Boundary follow-up: the maximum 4 MiB file exposed recursion in the original base64 regular expression. Validation now uses a simple alphabet check and canonical round-trip; the added boundary test accepts the exact-size payload. The browser evidence setup also explicitly waits for authenticated entry before issuing setup requests.
- Screenshots: `evidence.png`, `evidence-mobile.png`. They use synthetic test data. No archive extraction, antivirus scanning, hosted object storage or performance capacity is claimed.


## Run-comparison upgrade — 31 October 2026

- `npm test`: **29 passed, 1 skipped, 0 failed** locally, including comparison behavior on SQLite and PGlite.
- `npm run build`: strict TypeScript checking and the production build passed.
- `npm run test:e2e`: **1 passed** for account/project/case/result/defect creation.
- `npx playwright test --config playwright.demo.config.ts`: **2 passed**, covering public entry and run comparison/export/direction swapping/mobile layout.
- Comparison coverage includes all seven categories, changed definitions excluded from regression counts, archived-case evidence, rejected active/self/foreign runs, manual missing durations, final-retry durations and reordered automation reports.
- HTTP coverage checks malformed query rejection, viewer read access and cross-project denial.
- The PostgreSQL wire-driver test now includes comparison and duration assertions. It remains skipped locally without `TEST_POSTGRES_URL`; CI runs it against PostgreSQL.
- Screenshots: `comparison.png` and `comparison-mobile.png`. These show synthetic sample outcomes.
- GitHub Actions completed successfully for application commit `bec698d`, including the real PostgreSQL wire-driver test (**30 passed, 0 skipped**).
- Render public-demo deployment `dep-dbis4ivavr4c73bdcddg` reached `live` for that commit. Both public browser scenarios passed against `https://qualityhub-public-demo.onrender.com/` (entry and comparison/export/mobile).

The earlier record below describes the initial release and its checks; it is retained as historical context.


Release 0.2, checked on 30 October 2026 with Node.js 24.17.0.

## Executed automated checks

- `npm test`: **23 passed, 1 skipped, 0 failed**.
- `npm run build`: strict TypeScript checks and Vite production build passed.
- `npm run test:e2e`: the full Chromium workflow passed locally (1 test). The setup-key protection is covered by a dedicated first-owner registration test. Registration also verifies that the password hint is an accessible description rather than part of the field name.
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

## Deployment configuration

The Render Blueprint passes validation against Render’s published JSON Schema. This checks configuration structure; account-specific availability, resource creation and live HTTPS behavior are verified during deployment.

## Explicit verification limits

The standalone PostgreSQL wire-driver test was skipped locally because `TEST_POSTGRES_URL` was not configured. PGlite coverage does not verify a remote PostgreSQL connection, TLS configuration or a hosted database. GitHub Actions is configured to run that driver test with a PostgreSQL service after the repository is uploaded; no remote CI result is claimed here.

The Docker Compose stack was not executed in this environment. The browser interactions listed above were performed against the running application. No public deployment, load benchmark, external user adoption or completed security audit is claimed.
