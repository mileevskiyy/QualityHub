# QualityHub

**Versioned test management, reproducible execution history and traceable defects.**

QualityHub is a full-stack quality-engineering application built with **React, TypeScript, Node.js, Express and PostgreSQL**, with SQLite available for a zero-configuration local installation. It connects manual test design and automated Playwright execution through a shared project model, role-based access and immutable execution snapshots.

The central design principle is that a test definition can evolve while the evidence collected against a previous release must remain trustworthy.

![QualityHub workspace](docs/qualityhub-preview.png)

## Capabilities

- **Versioned test library:** suites, priorities, preconditions, ordered steps, expected outcomes, search, filters, history and archival.
- **Snapshot-based execution:** each run preserves the selected test definitions and their version numbers at creation.
- **Controlled run lifecycle:** explicit outcomes, required observations for failures, completion checks and read-only completed runs.
- **Traceable defects:** issues originate from failed or blocked executions and retain their source run and test version.
- **Project collaboration:** account registration through invitations, session-based authentication and owner/tester/viewer permissions.
- **Access administration:** invitations, membership changes and removal, with protection against deleting the last project owner.
- **Automation integration:** a custom Playwright reporter, project-scoped integration tokens, retry history and idempotent report ingestion.
- **Persistence:** transactional SQLite or PostgreSQL storage, schema migration tracking, foreign keys and uniqueness constraints.
- **Visibility:** project activity, execution summaries and JSON export of active test definitions, run snapshots and defects.

## Technology choices

| Layer | Technology | Responsibility |
| --- | --- | --- |
| Interface | React, TypeScript | Typed project, case, execution and defect workflows |
| Development and build | Vite | Local frontend development and production assets |
| HTTP service | Node.js 24, Express 5 | API routing, sessions and application boundaries |
| Input validation | Zod | Structured validation of interactive and automation payloads |
| Relational storage | PostgreSQL / SQLite | Durable records, constraints and transactional state changes |
| PostgreSQL driver | node-postgres | Parameterized queries and transaction-bound connections |
| Authentication | Node crypto | Salted scrypt password hashes and hashed session tokens |
| Automation | Playwright reporter | Test identities, execution attempts and report delivery |
| Verification | Node test runner, PGlite | Domain, API and PostgreSQL-engine integration checks |
| Delivery | GitHub Actions, Docker Compose | Repeatable checks and a local PostgreSQL application stack |

PGlite runs a PostgreSQL engine inside the test process. It provides SQL and transaction coverage without a Docker dependency; the separate PostgreSQL wire-driver test runs when `TEST_POSTGRES_URL` is configured.

## Quick start

### Disposable public demo mode

Set `PUBLIC_DEMO=true` to run an isolated, in-memory SQLite workspace with a **Try the demo** entry button. The server creates a synthetic operator and grants access to the seeded example project. Visitors share this disposable workspace; changes and sessions are discarded when the process restarts. Do not enter personal data.

This mode refuses `DATABASE_URL`, never connects to the persistent PostgreSQL workspace, and does not require a setup key or visitor password. Existing authentication and CSRF checks still protect interactive changes. With `PUBLIC_DEMO` unset, normal account registration, invitations and persistent storage behave as before.

Run the demo locally with `PUBLIC_DEMO=true npm start` after building. Verify visitor entry with `npx playwright test --config playwright.demo.config.ts`.

Requires **Node.js 24 LTS** and npm. Run commands from the repository root.

```sh
npm ci
npm run build
npm start
```

Open **http://127.0.0.1:3100**. Create the first account through the setup screen. That account receives ownership of any existing local projects. Passwords require at least 12 characters. Subsequent accounts need an invitation for their email address.

The default SQLite database is created under `data/`. The initial storefront contains clearly labelled fictional cases and results to demonstrate the workflow. These are sample records, not customer usage or measured business impact.

For frontend and API development:

```sh
npm run dev
```

Open http://127.0.0.1:5173. To use custom environment variables with the development scripts, export them in the terminal first. `npm start` automatically reads `.env` if present.

### PostgreSQL

To connect an existing database, copy `.env.example` to `.env` and set:

```dotenv
DATABASE_URL=postgresql://qualityhub:YOUR_PASSWORD@127.0.0.1:5432/qualityhub
```

Restart the service. The application creates its tables and applies tracked schema changes. Changing this setting selects a different database; it does not transfer existing SQLite records.

Alternatively, with Docker and Docker Compose installed:

1. Copy `.env.example` to `.env`.
2. Set `POSTGRES_PASSWORD` to a long, URL-safe password, such as a random hexadecimal string.
3. Run:

```sh
docker compose up --build
```

The app is exposed only on the local computer at port 3100. PostgreSQL stays on the Compose network. Named-volume data survives container restarts. The Compose configuration is a local development setup; an internet deployment also needs HTTPS and the production configuration described below.

## Core workflow

1. Create a project and add cases to its test library.
2. Specify the scenario, prerequisites, steps and expected outcome.
3. Create a test run from selected active cases.
4. Record passed, failed, blocked or skipped outcomes; failed and blocked results require an observation.
5. Create a defect from a failed or blocked execution. The report is prefilled with the saved steps, expected behavior and actual observation.
6. Complete the run once all selected cases have an outcome. Retesting is represented by a new run.
7. Use the library history, originating defect links and project activity to inspect how the evidence was produced.

## Architecture

![QualityHub architecture](docs/architecture.png)

[Editable diagram source](docs/architecture.mmd)

### Data model

`projects` establish the access boundary. `memberships` attach users and roles to individual projects. `cases` hold current test definitions; `case_versions` retain previous definitions. `runs` group executions, and `results` store the exact definition and version used for each execution. `defects` reference individual results. `imports`, `external_cases` and `automation_attempts` provide automation identity, replay protection and retry evidence.

Sessions, invitations and integration tokens store hashed bearer values rather than reusable plaintext secrets. Integration-token values are displayed only when created.

## Engineering challenges and decisions

### Preserving evidence while test definitions change

A direct relationship to the current test definition would allow a later edit to change the apparent meaning of an old result. QualityHub stores an independent snapshot for each execution. Updating or archiving a library case therefore preserves the content tested in an earlier run.

**Result:** historical evidence remains reproducible and can be inspected without reconstructing the current library state.

### Preventing stale writes

An editor can remain open while another operation changes the same record. Test-case updates require the version previously observed by the client; result updates require an execution revision. A stale request receives HTTP 409 instead of overwriting newer information.

**Result:** conflicts become explicit application states. The test suite checks that rejected writes leave newer content intact.

### Keeping multi-record changes atomic

Creating a case version, assembling a run or importing an automated report modifies multiple records. These operations execute in a shared transaction boundary, including their associated activity entries. Nested domain operations participate in the existing transaction.

SQLite access is serialized within the process. PostgreSQL transactions use a dedicated connection and an advisory transaction lock to coordinate writes across application processes. This favors predictable correctness over maximum write throughput; finer-grained locking is a future optimization.

**Result:** partial runs, orphaned evidence and partially imported reports are avoided when an operation fails.

### Handling repeated automation delivery

CI delivery may be retried after a timeout even when the first request succeeded. Each report carries an external run identifier and a normalized payload hash. An identical replay returns the existing run; reusing the identifier with different content returns a conflict.

**Result:** retried delivery does not inflate run counts or duplicate defects and execution evidence. Every reported Playwright attempt is retained separately from the final test outcome.

### Enforcing permissions at the API boundary

Hiding a button cannot prevent direct HTTP access. Every project resource is checked against membership and the action's required role. Integration tokens are scoped to one project's report-ingestion endpoint and do not grant interactive workspace access.

**Result:** viewers cannot mutate records, testers cannot administer membership or tokens, and unrelated projects are inaccessible to non-members.

## Collaboration and authentication

| Action | Owner | Tester | Viewer |
| --- | --- | --- | --- |
| Read cases, runs, defects and exports | Yes | Yes | Yes |
| Edit cases and execution results | Yes | Yes | No |
| Create and complete runs | Yes | Yes | No |
| Import automation reports interactively | Yes | Yes | No |
| Manage members and integration tokens | Yes | No | No |

All signed-in users may create a new project, which they own. Invitations expire after 48 hours and are bound to the invited email address. The owner shares the invitation code privately; the application does not send invitation emails. Removing membership immediately removes that account's project access.

Passwords use salted scrypt hashes. Session cookies are HTTP-only and SameSite Strict; state-changing interactive requests require a session-specific CSRF token. Authentication endpoints have an in-process attempt limit. Sessions expire after seven days and logout invalidates the stored token.

## Playwright integration

Copy `integrations/playwright-reporter.ts` into the repository containing the tests, or reference it from a shared workspace. Add it alongside a terminal reporter:

```ts
reporter: [
  ['list'],
  ['./integrations/playwright-reporter.ts'],
]
```

In QualityHub, open **Automation**, create a project integration token, and configure the test process:

```dotenv
QUALITYHUB_URL=http://127.0.0.1:3100
QUALITYHUB_PROJECT_ID=YOUR_PROJECT_ID
QUALITYHUB_TOKEN=YOUR_PRIVATE_INTEGRATION_TOKEN
QUALITYHUB_RUN_ID=YOUR_UNIQUE_CI_EXECUTION_ID
QUALITYHUB_RUN_NAME=Storefront regression
```

The project ID is shown in the Automation panel. Store the token as a CI secret. Give separate CI executions distinct run IDs; use the same ID and saved payload when retrying delivery of one execution. Include the CI attempt identifier when rerunning the tests themselves.

The reporter writes `test-results/qualityhub-report.json` before attempting upload. If no upload configuration is present, the saved file can be imported through the Automation panel. Remote uploads require HTTPS; localhost HTTP is allowed for development. Reports are limited to 500 tests and the API rejects request bodies over 8 MB. Execution retries are retained; file attachments and browser traces are not uploaded by this version.

## Verification

```sh
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

`npm test` exercises domain invariants, authentication, role enforcement, project isolation, persistence, report replay and concurrent import behavior against SQLite and PGlite. Set `TEST_POSTGRES_URL` to a disposable PostgreSQL database to run the real driver integration test as well; that test creates and removes an isolated schema.

The GitHub Actions workflow provisions PostgreSQL, runs the server checks, builds the interface and runs a Chromium workflow. The browser suite starts an isolated database and requires port 3100 to be free. See [verification record](docs/VERIFICATION.md) for checks actually executed on the current release.

## Render deployment

The included `render.yaml` defines a Docker web service and PostgreSQL database, with deploys gated on passing GitHub checks. It uses free plans for a temporary demo; Render Free PostgreSQL expires after 30 days. Review the current terms before creating resources. See [Render setup](docs/DEPLOY_RENDER_RU.md).

In production, the first owner registration requires the generated `SETUP_KEY`. The application accepts Render’s own `RENDER_EXTERNAL_URL` as a trusted origin.

## Deployment and operational boundaries

The application binds to loopback by default. For a remote Node deployment, configure `HOST`, `DATABASE_URL`, `APP_ORIGIN`, `SETUP_KEY` (at least 32 characters) and `NODE_ENV=production`, and place the service behind HTTPS. Production mode enables Secure cookies. Bootstrap the first account privately before making the service accessible to other people.

This release does not include password recovery, email verification, organization-wide SSO, file attachments or operational monitoring. Authentication throttling is process-local. Lists are not paginated, the activity endpoint returns the latest 60 entries and PostgreSQL writes are conservatively serialized. No production scale or availability claim is implied.

JSON export is a portable report, not a full backup. For complete SQLite backup, stop the application and copy its database directory. Use PostgreSQL backup tooling for that backend and verify restoration before relying on it.

## Repository layout

```text
src/                  React interface and typed API client
server/               API, domain model, authentication and persistence
integrations/         Playwright reporter and example configuration
tests/                Domain, HTTP, collaboration and browser tests
docs/                 Architecture, verification and development notes
.github/workflows/    Automated verification pipeline
compose.yaml          Local app and PostgreSQL stack
```

[Architecture details](docs/ARCHITECTURE.md) · [Development roadmap](docs/ROADMAP.md) · [GitHub upload guide](docs/GITHUB_UPLOAD_RU.md)
