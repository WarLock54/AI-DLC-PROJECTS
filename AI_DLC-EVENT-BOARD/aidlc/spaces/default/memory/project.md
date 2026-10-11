# Project-Level Rules

> Project-specific specialisation and corrections. Loaded after `org.md` and
> `team.md` as strict-additive guidance; contradictions with broader policy
> are rejected. Populated by practices-discovery and the self-learning loop.
>
> Use sparingly: most teams don't need a project layer. Reach for it
> only when this specific project needs stable, durable guidance beyond the
> team practice (for example, package-specific release checks or an additional
> regression suite for a legacy component).

## Way of Working

<!-- Project-specific specialisation. Example: -->
<!-- This monorepo requires package-scoped branch names and a package owner -->
<!-- review in addition to the team's normal merge policy. -->

## Walking Skeleton

<!-- Project-specific specialisation. Example: -->
<!-- The walking skeleton must exercise the legacy service adapter as well -->
<!-- as the new service boundary. -->

## Testing Posture

<!-- Project-specific specialisation. -->

## Guard Policy

<!-- Project-specific. Mode: strict, relaxed, or off. Strict here holds for every intent and cannot be changed from chat. A section under the retired Change Control heading, written by an earlier release, is still read. -->

## Deployment

<!-- Project-specific specialisation. -->

## Code Style

<!-- Project-specific specialisation. -->

## Tech Stack

<!-- Technology choices locked for this project. -->

## Decided

<!-- Decisions made in earlier stages that should not be re-asked. -->
<!-- Format: DECIDED: [decision] (Stage [slug], [date]) -->

## Scope Overrides

<!-- Custom scope rules for this project. -->

## Forbidden

<!-- Populated by practices-discovery affirmation gate. -->
<!-- Format: NEVER [behavior] (affirmed [date]) -->
<!-- Example: NEVER throw exceptions across service layer boundaries (affirmed 2026-05-17) -->

- NEVER squash-merge or fast-forward-merge this project's feature branches into `main`. (affirmed 2026-10-01)

- NEVER require manual cloud console setup, deployment, verification, or cleanup steps for the final run. (affirmed 2026-10-01)

- NEVER allow the pipeline to exit 0 before the deployed application is actually up and health-checked. (affirmed 2026-10-01)

- NEVER execute cleanup as part of the normal `main` pipeline or final verification deployment. (affirmed 2026-10-01)

- NEVER destroy resources from the normal `main` pipeline. (affirmed 2026-10-01)

- NEVER leave debug-only `AWS_SESSION_TOKEN` configured for final verification. (affirmed 2026-10-01)

- NEVER hardcode or commit credentials, secrets, local AWS profiles, account-specific assumptions, cloud access keys, or session tokens. (affirmed 2026-10-01)

- NEVER print secrets or credentials in logs, artifacts, seed data, or documentation. (affirmed 2026-10-01)

- NEVER depend on real email delivery in the final fresh sandbox when SES recipient verification is unavailable. (affirmed 2026-10-01)

- NEVER use real resident data, unnecessary sensitive attributes, corporate email addresses, or non-synthetic demo data. (affirmed 2026-10-01)

- NEVER name AWS resources without the `team32-ceb-` prefix. (affirmed 2026-10-01)

- NEVER weaken the 80% backend business-logic coverage floor to make a step pass. (affirmed 2026-10-01)

- NEVER treat IaC line coverage as a substitute for `cdk synth`, CDK assertions, `cdk-nag`, and smoke-test validation. (affirmed 2026-10-01)

- NEVER drop archival, shareable URLs, the 5 MB banner limit, monitoring/alerting evidence, or cleanup proof from the approved MVP scope. (affirmed 2026-10-01)

- NEVER implement RSVP capacity with a non-atomic read-then-write path that can exceed capacity under concurrency. (affirmed 2026-10-01)

- NEVER return silent or log-only failures for API-boundary validation, missing event URLs, banner limit violations, RSVP/waitlist transitions, or reminder fallback. (affirmed 2026-10-01)

- NEVER allow wildcard IAM actions or resources without documented justification. (affirmed 2026-10-01)

- NEVER accept High/Critical security findings without an explicit documented waiver. (affirmed 2026-10-01)

- NEVER add DAST as a blocking MVP gate for this two-day run unless a later approved scope change reintroduces it. (affirmed 2026-10-01)

- NEVER add external city/CMS/calendar/identity/analytics/reporting integrations unless a later approved scope change adds them. (affirmed 2026-10-01)

## Mandated

<!-- Populated by practices-discovery affirmation gate. -->
<!-- Format: ALWAYS [behavior] (affirmed [date]) -->
<!-- Example: ALWAYS use Result<T,E> for fallible operations in service layer (affirmed 2026-05-17) -->

- ALWAYS write human-reviewed workflow artifacts and human-facing output in English for this session. (affirmed 2026-10-01)

- ALWAYS use one short-lived feature branch per GitLab issue or Construction unit for this project. (affirmed 2026-10-01)

- ALWAYS create project feature branches from `main` and merge them back to `main` through reviewed GitLab merge requests. (affirmed 2026-10-01)

- ALWAYS reference the related issue in each merge request with `Closes #N`. (affirmed 2026-10-01)

- ALWAYS use merge commits only, with no squash merge and no fast-forward merge, for this project because `SETUP.md` 6.4 requires merge request and commit history as a deliverable. (affirmed 2026-10-01)

- ALWAYS treat Onur as the sole current project owner and maintainer; do not assume a separate teammate owns files or must approve changes. Historical audit records retain their original attribution. (updated 2026-10-11)

- ALWAYS build the first slice as a CDK app deploying `GET /api/health` behind CloudFront, API Gateway, and Lambda, with deterministic seed data and a passing `validate -> deploy -> health check` GitLab pipeline in a clean sandbox. (affirmed 2026-10-01)

- ALWAYS use TypeScript end to end, AWS CDK v2 for IaC, and Node.js 22.x Lambdas. (affirmed 2026-10-01)

- ALWAYS provision and deploy the Community Event Board infrastructure and application through IaC and GitLab CI/CD with no manual cloud console steps. (affirmed 2026-10-01)

- ALWAYS run idempotent `cdk bootstrap` before deploy in the pipeline. (affirmed 2026-10-01)

- ALWAYS use `us-east-1` through `AWS_DEFAULT_REGION`. (affirmed 2026-10-01)

- ALWAYS make the normal `main` pipeline deploy and exit 0 only after deployment and health check succeed. (affirmed 2026-10-01)

- ALWAYS leave the final verification deployment running. (affirmed 2026-10-01)

- ALWAYS make cleanup/teardown a separate explicitly triggered script or CI job, for example `TEARDOWN=true`. (affirmed 2026-10-01)

- ALWAYS delete any debug-only `AWS_SESSION_TOKEN` CI variable before final verification. (affirmed 2026-10-01)

- ALWAYS keep AWS credentials in CI variables or approved AWS secret stores, never in source, logs, artifacts, seed data, or documentation. (affirmed 2026-10-01)

- ALWAYS use deterministic seeded data for deployment verification, demo flows, and admin-stat assertions. (affirmed 2026-10-01)

- ALWAYS preserve all approved functional and infrastructure requirements, including organizer CRUD, resident browse/filter, shareable event URLs, RSVP/waitlist, reminders, admin statistics, 5 MB banner limit, archival, monitoring/alerting evidence, GitLab deployment, health check, and debug-sandbox cleanup proof. (affirmed 2026-10-01)

- ALWAYS treat archival as backend/S3 or operational evidence unless a later approved scope change adds UI archival requirements. (affirmed 2026-10-01)

- ALWAYS apply an 80% line-coverage floor to backend business logic for RSVP/waitlist, statistics, archival, and reminder selection. (affirmed 2026-10-01)

- ALWAYS validate infrastructure with `cdk synth`, CDK assertions, `cdk-nag`, and deployment smoke tests. (affirmed 2026-10-01)

- ALWAYS include an RSVP concurrency test proving parallel requests never exceed capacity. (affirmed 2026-10-01)

- ALWAYS enforce API-boundary input validation with deterministic error responses. (affirmed 2026-10-01)

- ALWAYS preserve stable shareable event URLs and deterministic seed-data identifiers. (affirmed 2026-10-01)

- ALWAYS enforce the 5 MB banner upload limit server-side. (affirmed 2026-10-01)

- ALWAYS use resource names with the prefix `team32-ceb-`. (affirmed 2026-10-01)

- ALWAYS run CI gates for ESLint, Prettier, unit tests with coverage, `cdk synth`, `cdk-nag` AwsSolutions, `npm audit`, and secret scanning. (updated 2026-10-11)

- ALWAYS block High/Critical findings unless they are explicitly waived and documented with owner, justification, and expiry. (affirmed 2026-10-01)

- ALWAYS apply least-privilege IAM to deploy and runtime roles and document any unavoidable wildcard IAM. (affirmed 2026-10-01)

- ALWAYS provide verifiable monitoring/alerting evidence for health checks, Lambda/API errors, throttles, high latency, reminder failures, auth failures, and denied admin actions. (affirmed 2026-10-01)

- ALWAYS use checked-in lockfiles and pinned CI/tool versions where practical. (affirmed 2026-10-01)

## Corrections

<!-- Project-specific corrections from human feedback. -->
<!-- Format: NEVER/ALWAYS [behavior] (learned [date]) -->
- On Windows with Copilot CLI, PostToolUse hooks do not fire, so stage output writes are not recorded in the audit log. The human records them with `aidlc engine hook write-audit-log` before the review is retried. Do not regenerate or re-save reviewed outputs to work around a missing write record; ask the human instead. (learned 2026-10-01) <!-- cid:261001-community-event-board:intent-capture:87c1a85a88afd06622528f081d1baca48251758c427f68acd95f9a7cbde5a524 -->
- ALWAYS leave the final verification deployment running; prove cleanup in a debug sandbox and document it rather than executing cleanup in the final run. (learned 2026-10-01) <!-- cid:261001-community-event-board:scope-definition:abbdd2dfd793b79fc3f44c7bd71bacb7ce3a2573c9a0bf5938b23f8c0b3b0027 -->
- ALWAYS treat rough mockups for DevOps-focused MVP runs as verifier-oriented low-fidelity UI rather than product polish. (learned 2026-10-01) <!-- cid:261001-community-event-board:rough-mockups:0007002d9f802a668ede97133119ca5dc9daf0031cbc80b873313e236df19057 -->
- Show RSVP cancellation as a one-time link (learned 2026-10-01) <!-- cid:261001-community-event-board:refined-mockups:edde891ae63365295a075caff7b6d43a7be3ae76b7ffbd4ae82e6366eda94c0b -->
- In this Copilot setup, functions.apply_patch saves did not produce AI-DLC artifact-write records. Verify recording before requesting review. If records are missing, use the manual recovery documented in docs/sandbox-rotation.md rather than repeatedly reconfirming or regenerating unchanged artifacts. (learned 2026-10-01) <!-- cid:261001-community-event-board:refined-mockups:a1dc0f1bb4ecea3392e813b831cc00820b4969c1bc095501cc2c2e27011e9f14 -->
- In Build and Test, treat any target that needs a deployed AWS account as Unverified when the active scope skips the Operation stages; the load test, real-email proof, and cleanup proof are human-run debug-sandbox evidence. (learned 2026-10-06) <!-- cid:261001-community-event-board:build-and-test:0c4390acf5eb57f76341c7164bbc1dc14aeb38ec30d2cf062537aedd894d1eab -->
- Before running Build and Test, compare the CI test job in .gitlab-ci.yml against docs/evidence-manifest.md; every suite listed as CI proof must run in CI. (learned 2026-10-06) <!-- cid:261001-community-event-board:build-and-test:41a5aadb53a1e636caa9f9ef5c4313f3de327bbf0610a2e0ade991a1b9936b28 -->
