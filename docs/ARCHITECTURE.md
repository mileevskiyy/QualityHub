# Architecture and consistency model

## Domain boundaries

The API validates request shape through Zod, resolves session or integration identity, checks project authorization and delegates to domain operations. React consumes the same project-scoped endpoints for interactive workflows. Database access is parameterized; persistence is asynchronous and supports SQLite or PostgreSQL.

## Definitions versus evidence

`cases` represents the latest active library state. Every edit inserts a `case_versions` record. `results.snapshot` captures the complete definition selected for one run, including its version. Archival affects library visibility without deleting historical evidence. Completing a run prevents subsequent changes to its execution results; defect resolution remains independent.

## Transactions and concurrency

A process-local queue coordinates operations on a Store instance. AsyncLocalStorage propagates a transaction context through nested domain operations. SQLite uses `BEGIN IMMEDIATE`; PostgreSQL binds the transaction to a pool connection and takes a transaction-scoped advisory lock. Writes across PostgreSQL application processes are intentionally serialized in this release.

Case updates and result writes validate the client's observed version or revision while inside that boundary. All domain writes and their associated events commit or roll back together. Defect-status changes remain last-write-wins; historical execution evidence is unaffected.

Database schema initialization is idempotent for a normal single-instance startup. Migration version 2 adds execution ordering and the collaboration/automation schema. Coordinate application rollout so only one instance initializes a new database at a time; a dedicated migration runner is future operational work.

## Authentication and authorization

The first registered account owns pre-existing local projects. Further registration requires an unexpired invitation matching the email address. Passwords use salted scrypt hashing. Session tokens, invitation codes and integration credentials are represented by SHA-256 hashes in persistent storage.

Interactive requests authenticate through HTTP-only, SameSite Strict cookies. Mutations require a per-session CSRF token, and unexpected browser origins are rejected. Owner/tester/viewer checks apply at the API boundary for every project path. A missing membership returns not found to avoid exposing another project's resources.

Integration tokens can reach only the report-ingestion route for their associated project. They cannot read library data or manage users. Revocation takes effect on the next request. The last owner cannot be removed or demoted.

## Automation model

The reporter derives an external case identifier from the Playwright project, relative file path and title path. Changing that identity creates a distinct case. Every retry carries its own outcome, duration and error text. The final attempt is compared with Playwright's expected status to derive the run result; skipped and interrupted outcomes have explicit mappings.

An imported report is identified by `(project_id, external_id)` and a normalized payload hash. Identical delivery returns the original run. Different content under an existing ID is rejected. Importing cases, executions, attempts and the replay record happens in one transaction.

The REST attempts endpoint exposes the retry records for an authorized run. The main execution UI shows the final outcome and a note describing the number of attempts. Attachment upload and historical flakiness calculations are future capabilities.

## Storage and operation

SQLite offers a self-contained local setup. Setting `DATABASE_URL` selects PostgreSQL via node-postgres. Both engines use the same domain model; switching does not migrate data automatically. PGlite tests exercise a PostgreSQL engine, while the optional PostgreSQL driver test covers network-driver behavior against an actual server.

The current deployment target is a Node.js process. The provided Docker Compose configuration runs the app and PostgreSQL locally. A static frontend deployment alone cannot provide this application's sessions, API and database behavior.

## Current boundaries

No password recovery, email verification, SSO, attachment storage or production monitoring. Authentication throttling is in-process. Lists are unpaginated; the activity endpoint returns up to 60 entries. This project does not claim verified production scale, active users or a completed external security assessment.
