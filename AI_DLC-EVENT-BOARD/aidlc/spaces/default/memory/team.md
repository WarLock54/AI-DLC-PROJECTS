# Team-Level Rules

> This team's affirmed practices and corrections. Loaded after `org.md` as
> strict-additive guidance; contradictions with broader policy are rejected.
> Populated by the practices-discovery affirmation gate. Edit at the gate,
> not directly.

## Way of Working

Onur is the sole current owner and maintainer of this project. Do not assume
separate teammate ownership, review, or approval dependencies. Continue using
the repository's branch and merge-request practices where they apply. Existing
AI-DLC audit records retain their original historical attribution and must not
be rewritten as though someone else performed that work.

## Walking Skeleton

<!-- Affirmed during practices-discovery. Example: -->
<!-- We don't run a walking skeleton — our deployment pipeline is mature -->
<!-- and the slice cost outweighs the value at our maturity stage. -->

## Testing Posture


- **Methodology**: test-after
- **Ordering**: implement each applicable testable layer, then write and run that layer's tests before the change is considered ready.
- Apply an 80% line-coverage floor to backend business logic: RSVP/waitlist, statistics, archival, and reminder selection.
- Do not treat IaC line coverage as the quality target. Validate infrastructure with `cdk synth`, CDK assertions, `cdk-nag`, and deployment smoke tests.
- Add one RSVP concurrency test proving parallel requests never exceed event capacity and overflow moves to the waitlist.
- Preserve proof for every approved functional and infrastructure expectation:
  - Organizer event management.
  - Resident browse/filter.
  - Shareable public event detail URLs.
  - RSVP capacity and waitlist behavior.
  - Reminder evidence.
  - Admin statistics over deterministic seed data.
  - 5 MB banner upload limit.
  - Event archival.
  - Clean-account IaC deployment.
  - GitLab CI/CD deployment and health check.
  - Monitoring/logging/alert evidence.
  - Cleanup proof in a debug sandbox.
- Treat archival as backend/S3 or operational evidence rather than a required UI screen.

## Guard Policy

<!-- Affirmed by the team. Mode: strict, relaxed, or off. Strict here holds for every intent and cannot be changed from chat. A section under the retired Change Control heading, written by an earlier release, is still read. -->

## Deployment


Use GitLab CI/CD as the deployment and release path.

- The normal `main` pipeline deploys; no manual cloud console steps are allowed.
- The pipeline exits 0 only after deployment succeeds and a health check confirms the application is running.
- The final verification deployment remains running for inspection.
- Cleanup/teardown is a separate script or CI job that runs only when explicitly triggered, for example with `TEARDOWN=true`.
- The normal `main` pipeline never destroys resources.
- The pipeline runs idempotent `cdk bootstrap` before deploy.
- Use `us-east-1` through `AWS_DEFAULT_REGION`.
- Debug runs may need `AWS_SESSION_TOKEN` as a CI variable. Delete it before final verification because the orchestrator overwrites only `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `AWS_DEFAULT_REGION`.

## Code Style

<!-- Team-specific conventions beyond the linter. Example: -->
<!-- - Prefer named exports over default exports -->
<!-- - All async functions return Result<T, E>, never throw -->

## Forbidden

<!-- Team-specific forbidden patterns -->

## Mandated

<!-- Team-specific mandates -->

## Corrections

<!-- Self-learning loop appends here. -->
