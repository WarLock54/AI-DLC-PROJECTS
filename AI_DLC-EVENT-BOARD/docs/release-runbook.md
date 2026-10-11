# Release and Evidence Runbook (C7)

Ordered steps from the debug sandbox to the final verification run. Everything marked
**debug sandbox** is run explicitly by a person with debug-sandbox credentials. None of it
runs in the final verification pipeline, and none of it appears in `.gitlab-ci.yml` (the
manifest check fails if it does).

The evidence tools live in `scripts/evidence/`. They read only environment credentials
(`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_DEFAULT_REGION=us-east-1`, plus
`AWS_SESSION_TOKEN` when the debug sandbox issues one), never a local AWS profile, and every
evidence file is redacted before it is written (no account IDs, ARNs, keys, tokens, JWTs, or
email local parts).

## Prerequisites

- Node.js 22.x and `npm ci`.
- A debug sandbox where the normal `main` pipeline has already deployed the stack, so that
  `cdk-outputs.json` exists locally (download the `deploy` job artifact) or
  `CDK_OUTPUTS_FILE` points to it.
- Debug credentials exported in your shell only. Never commit them or paste them into a log.

## 1. Load test (debug sandbox, NFR7 and NFR8)

```bash
LOAD_TEST=true npm run evidence:load-test
```

- Creates a fixture event with capacity 20 through the organizer API (the seeded organizer's
  password is read from Secrets Manager at run time and never printed), then runs 500 virtual
  users: 2-minute ramp-up, 8-minute steady state, 70/20/10 flow mix.
- Waits `LOAD_TEST_METRIC_SETTLE_SECONDS` (default 300) so CloudWatch has the datapoints, then
  reads API Gateway p95 latency, API Gateway 5xx, and Lambda throttles for the exact window.
- Reads the fixture event back to prove confirmed RSVPs never exceed capacity and the overflow
  went to the waitlist.
- Optional settings: `LOAD_TEST_API_ID` (only if the account has more than one HTTP API) and
  `LOAD_TEST_THINK_TIME_MS` (default 1000).
- Writes `docs/load-test.md` and exits non-zero unless every criterion passes. A failing run
  still writes an honest FAIL document; fix the cause and run again. Thresholds are constants
  in `scripts/evidence/metrics.ts` and are not configurable.

## 2. SES reminder proof (debug sandbox, FR7.6)

1. Verify one personal sender identity and one personal recipient identity in SES (SES sandbox
   accounts can only send to verified identities). Do not use a corporate address.
2. Switch the worker to SES mode in the debug sandbox only (see
   `docs/c5-reminders-statistics-archival.md`, "SES"):

   ```bash
   npx cdk deploy team32-ceb-async-monitoring \
     -c reminderEmailMode=ses \
     -c reminderSenderEmail=<verified sender address> \
     -c reminderSenderIdentityArn=<SES identity ARN>
   ```

3. Run the proof (add `SES_PROOF_INVOKE_SELECTOR=true` to also invoke the deployed reminder
   selector once):

   ```bash
   DEBUG_SANDBOX=true SES_PROOF_SENDER=<verified sender> SES_PROOF_RECIPIENT=<verified recipient> \
     npm run evidence:ses-proof
   ```

   The tool refuses to send unless both identities are verified, and records the SES message
   ID and outcome only (domain names, never local parts).
4. Redeploy through the normal `main` pipeline so the sandbox returns to `EMAIL_MODE=log`.
   The final sandbox never depends on real email delivery.

## 3. Cleanup proof (debug sandbox, NFR17, NFR18, NFR30)

1. In GitLab choose **Build > Pipelines > Run pipeline**, branch `main`, variable
   `TEARDOWN=true` (typed into the form only, never saved as a project variable). Only the
   `teardown` job runs.
2. Save the job output to a file, for example `teardown.log` (the job log's raw download), and
   note the job exit status.
3. Capture the evidence, including an independent post-teardown inventory:

   ```bash
   TEARDOWN_EVIDENCE=true npm run evidence:cleanup -- --log teardown.log --exit-status 0
   ```

   Add `--no-live` to skip the AWS inventory. The proof passes only when the job exited 0, no
   `team32-ceb-` stacks remain, and the tag query `project=team32-ceb` returns nothing.
   Writes `docs/cleanup.md`.
4. The teardown removes the debug deployment. Rotate to the final sandbox next.

## 4. Cost notes (NFR9)

```bash
npm run evidence:cost-notes
```

Regenerates `docs/cost-notes.md` from `scripts/evidence/cost-model.ts`. Edit the model (named
prices and scenario assumptions), not the Markdown. The command fails if the estimate reaches
$30 per month.

## 5. Remove debug-only credentials (NFR29)

Delete the `AWS_SESSION_TOKEN` CI/CD variable (Settings > CI/CD > Variables, or the GitLab
variables API) before final verification. The final-verification orchestrator overwrites only
`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `AWS_DEFAULT_REGION`. Also confirm there is no
project-level `TEARDOWN` variable. See `docs/c2-ci-cd.md` and `docs/sandbox-rotation.md`.

## 6. Final rehearsal and verification run (NFR17, NFR20)

1. Update the three CI variables for the fresh final sandbox.
2. Push to `main` (or run the pipeline on `main` without `TEARDOWN`). The pipeline runs
   `validate -> deploy -> health-check`, bootstraps idempotently, deploys, seeds, archives the
   seeded fixture, and exits 0 only after the HTTPS health check and the admin statistics
   check pass.
3. **Leave the deployment running.** Do not run teardown, the load test, or the SES proof in
   the final sandbox.

## 7. Evidence manifest

```bash
npm run evidence:manifest-check -- --write --require-recorded
```

Regenerates `docs/evidence-manifest.md` and fails if any proof file is missing, if a
debug-sandbox proof is still a `Pending debug-sandbox run` placeholder, or if debug-only
evidence is wired into `.gitlab-ci.yml`. In every CI pipeline the check runs without
`--require-recorded`, so pending debug evidence is shown honestly as `pending` rather than
failing validation before the debug runs have happened.

## What never happens in the final pipeline

| Activity | Where it runs | Guard |
| --- | --- | --- |
| 500-user load test | debug sandbox, by a person | `LOAD_TEST=true`, refuses when `GITLAB_CI` is set |
| Real SES delivery proof | debug sandbox, by a person | `DEBUG_SANDBOX=true`, refuses when `GITLAB_CI` is set |
| Cleanup evidence capture | debug sandbox, by a person | `TEARDOWN_EVIDENCE=true`, refuses when `GITLAB_CI` is set |
| Teardown | explicit `TEARDOWN=true` pipeline | separate job, never part of the `main` deploy path |
