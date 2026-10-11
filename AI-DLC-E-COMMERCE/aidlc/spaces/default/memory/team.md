# Team-Level Rules

> This team's affirmed practices and corrections. Loaded after `org.md` as
> strict-additive guidance; contradictions with broader policy are rejected.
> Populated by the practices-discovery affirmation gate. Edit at the gate,
> not directly.

## Way of Working
- We use trunk-based development on a single repository. `infra/`, `app/` and
  `.gitlab-ci.yml` sit at the repository root.
- Every issue gets its own short-lived feature branch named
  `<name>/<issue-no>-<short-desc>`.
- A branch reaches `main` through a merge request that references the issue
  ("Closes #N").
- We follow the org rule on merge style: Bolt branches are squash-merged into
  `main`, one commit per Bolt, named by the Bolt slug (org rule, kept as is).
- Merge requests are never fast-forwarded; the GitLab merge method is "Merge
  commit" so every MR leaves a merge commit, because the MR history is a
  required course deliverable (SETUP.md Step 6). Squashing a Bolt's commits
  inside the MR is allowed and keeps the org squash rule.
- `main` is not locked against pushes. The final verification lab commits to the
  repository to trigger deployment, so pushing to `main` must stay possible.
- Trunk-based development, short-lived branches and no long-lived release
  branches are org rules that apply unchanged.

## Walking Skeleton
- We skip the walking skeleton. The `classic` scope assigned to this scenario
  declares `skeleton: off`, and we follow that plan: no skeleton ceremony and no
  bootstrap checkpoint.

## Testing Posture
- **Methodology**: test-after
- **Ordering**: We implement each layer (infrastructure, then stub application
  code) and then write and run that layer's tests, and those tests run in the
  pipeline's `validate` stage.
- Application code is stub or minimal by design, so the tests are per layer and
  small.
- The 80% line-coverage floor applies to application (stub) code only. This is
  the org `classic` floor and it is not lowered for executable code.
- Infrastructure is declarative Terraform (HCL), which has no executed lines, so
  line coverage does not apply to it. The team explicitly affirmed this
  carve-out. It is compensating evidence and not a weaker floor for executable
  code.
- In place of line coverage, infrastructure is governed by a blocking
  resource-assertion or policy check. It confirms that encryption is on, no data
  store is public, IAM is least-privilege, and alarms are present. Every deployed
  resource type has at least one passing assertion. A failing assertion blocks
  the pipeline.
- The lines counted for the 80% floor exclude only test files, generated output,
  vendored dependencies and config-only files. Nothing else is excluded to reach
  the number.
- Each application component still gets a happy-path test and at least two
  error or edge-case tests. Tests assert observable behaviour such as status
  code, payload shape or error code, so a green coverage number cannot come from
  trivial tests. This also restates the Construction phase rule.
- After deployment, the pipeline runs a health-check and smoke-test step against
  the deployed application: the health endpoint responds, a product can be
  created and read, search returns results, and the rate limit throttles.
- The active Test Strategy still applies. Scope floors are added to it and never
  replace it (org rule).
- Performance targets from the scenario (search p95 under 200 ms; 200 to 2,000
  requests per second) are not test commitments in this stage. They are carried
  forward as open items in `evidence.md`.

## Guard Policy

<!-- Affirmed by the team. Mode: strict, relaxed, or off. Strict here holds for every intent and cannot be changed from chat. A section under the retired Change Control heading, written by an earlier release, is still read. -->

## Deployment
- The pipeline runs on GitLab CI, configured in `.gitlab-ci.yml` at the
  repository root.
- We have one environment only. Every commit to `main` is deployed
  automatically into the AWS sandbox.
- The org rule that production deploys wait for manual approval does not apply
  here, because no production environment exists. No deploy job may use a
  manual gate (`when: manual`), because the course does not allow it.
- Merge requests also run the `validate` stage: tests, coverage, secret
  detection, an infrastructure misconfiguration scan, and the resource
  assertions.
- The `main` pipeline runs `validate` again, then deploys, then runs the smoke
  tests. The pipeline exits 0 only when the application is fully deployed and
  running.
- A detected secret, or a High or Critical finding from the infrastructure scan,
  fails `validate`, so nothing is deployed. Gates are not switched off to get a
  build through (org rule that floors and gates are not weakened).
- Terraform state is kept in a remote backend (an S3 bucket plus a DynamoDB lock
  table). The first step of the pipeline creates them.
- The pipeline signs in to AWS with access keys stored as GitLab CI/CD
  variables, which the course requires. Credentials never appear in source or in
  pipeline files (existing Construction rule).
- Data stores are created without deletion protection, so cleanup always
  completes.
- A cleanup job or script deletes all deployed resources. It is safe to run
  twice.
- Sandbox accounts last 8 hours.
- The Operation phase rule that every deployment procedure documents a rollback
  step still applies. The rollback behaviour after a failed smoke test is not yet
  decided (see `evidence.md`).

## Code Style
- Infrastructure is written in Terraform. Application stubs are written in
  Python.
- We use `terraform fmt` and `tflint` for HCL and Black and Ruff for Python.
  Formatter and linter configuration lives in the repository root, and a linter
  failure in CI blocks the merge (org rule).
- Resource names follow `<project>-<env>-<component>`. Every resource carries the
  tags Project, Environment and Owner. This supports tag-based cleanup and cost
  tracking.
- `infra/` and `app/` stay separate. Application code reads resource names and
  endpoints from environment variables and never hardcodes them.
- Every product write goes through one function that both saves the product and
  invalidates the cache.
- All API endpoints use one error response shape: status, error code, message
  and request ID. Logs carry a request ID. If the cache fails, the request falls
  back to the source of truth.
- Naming inside source files follows each language's usual style (org rule).
- Credentials, keys and secrets are never hardcoded (existing Construction
  rule).
## Forbidden

<!-- Team-specific forbidden patterns -->

## Mandated

<!-- Team-specific mandates -->

## Corrections

<!-- Self-learning loop appends here. -->
