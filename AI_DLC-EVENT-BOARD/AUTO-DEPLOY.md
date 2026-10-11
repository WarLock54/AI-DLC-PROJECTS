# Deployment and Cleanup

## Pipeline behavior

The GitLab pipeline is defined in `.gitlab-ci.yml` and currently behaves as follows:

- Merge requests run the validation jobs only; they do not deploy to AWS.
- A push to `main` runs validation, deploys the CDK stacks, seeds deterministic demo data, performs the configured archival invocation, then runs health and statistics checks.
- The pipeline fails if any required validation, deployment, or post-deployment check fails.
- A teardown is a separate, explicitly started `main` pipeline with `TEARDOWN=true`. Setting `TEARDOWN=true` on a normal push does not make that push a teardown run.

The deployment script performs `cdk bootstrap`, deploys the foundation and async/monitoring stacks, and verifies the expected stack outputs. Health checks verify the HTTPS `/api/health` response and that the UI is served.

## AWS CI variables

Configure these as protected/masked GitLab CI/CD variables for the intended AWS account:

| Variable | Purpose |
|---|---|
| `AWS_ACCESS_KEY_ID` | Deployment identity access key |
| `AWS_SECRET_ACCESS_KEY` | Deployment identity secret key |
| `AWS_DEFAULT_REGION` | Target AWS region |

The deployment script requires environment credentials and rejects AWS profile configuration. Use least-privilege credentials; never store secrets in the repository, artifacts, or logs. For local credentials, use the standard AWS credential setup described in the AWS CLI documentation, but do not run deployment unless you intend to create billable resources.

## Validation before deployment

The pipeline runs build, lint, formatting, unit/integration tests, CDK synthesis, dependency/security checks, secret scanning, and the configured content scan before deployment. Run the same project validation locally with:

```powershell
npm ci
npm run validate
$env:AWS_DEFAULT_REGION = "us-east-1"
npm run synth
```

CDK synthesis does not deploy resources. The `main` pipeline is the deployment path currently checked into this repository.

## Teardown safety

`npm run teardown` refuses to run unless `TEARDOWN=true` is explicitly set. Teardown deletes project CloudFormation stacks and retained tagged resources, then verifies that the inventory is empty. It is destructive and should only be run against the intended environment after confirming the AWS identity and region.

The resource prefix and project tag currently used by the application are `team32-ceb-` and `project=team32-ceb`. These are wired into the infrastructure, deploy, and teardown code; changing them requires a coordinated migration and cleanup plan, not a documentation-only rename.
