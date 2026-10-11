# Auto-Deployment

Deployment happens in two phases, both using the same `.gitlab-ci.yml` pipeline in your repository.

---

## Phase 1 — Debug Sandbox (development)

Use a cloud account or subscription where you are authorized to create resources. If you use a temporary sandbox, follow its provider's access, expiration, and credential-rotation instructions.


How it works:

1. Request a sandbox — the orchestrator provisions a real cloud account and gives you credentials
2. Add the credentials to your GitLab project as CI/CD variables using the **exact required names** listed below
3. Deploy via your `.gitlab-ci.yml` pipeline or directly from your local machine with CLI/IaC commands
4. Test and debug against the running infrastructure
5. When the sandbox expires (8 h), request a new one and update your variables

Repeat until your deployment works reliably.

---

## Phase 2 — Final Verification (assessment)

When you are ready, run final verificator lab it will make commit to repo it should initiate deployment.

At that point:

1. The orchestrator provisions a fresh, isolated sandbox — **you have no access to it**
2. The orchestrator **overwrites your GitLab CI/CD variables** with the new sandbox credentials — using the same variable names you created in Phase 1
3. Your pipeline is triggered on `main`
4. The pipeline must exit **0** — any non-zero exit means deployment failed and verification is blocked
5. The AI verification agent inspects the live deployment on the external system

**This is why strict variable naming matters.** The orchestrator reuses the exact variable names you set up — so the same pipeline that worked in your debug sandbox will work unchanged in the final sandbox.

---

## Required CI/CD Variable Names

Create these variables in your GitLab project under **Settings → CI/CD → Variables**. Use the exact names — any deviation breaks the final verification.

### AWS

| Variable | Description |
|---|---|
| `AWS_ACCESS_KEY_ID` | IAM access key |
| `AWS_SECRET_ACCESS_KEY` | IAM secret key |
| `AWS_DEFAULT_REGION` | Target region |

**AWS sandbox limitations (must follow):**

- Use one AWS region only — the region provided by sandbox config (`AWS_DEFAULT_REGION`).
- EC2 instance types are restricted by sandbox policy to the `t2.*`, `t3.*`, and `t4g.*` families. If your architecture proposes EC2, choose only from these.

### Azure

| Variable | Description |
|---|---|
| `ARM_CLIENT_ID` | Service principal client ID |
| `ARM_CLIENT_SECRET` | Service principal secret |
| `ARM_TENANT_ID` | Tenant ID |
| `ARM_SUBSCRIPTION_ID` | Subscription ID |

### GCP

| Variable | Description |
|---|---|
| `GOOGLE_CREDENTIALS` | Service account JSON key (full file content) |
| `GOOGLE_PROJECT` | Project ID |
| `GOOGLE_REGION` | Deployment region |

---

## Pipeline Requirements

### `.gitlab-ci.yml`

Your repository must include a `.gitlab-ci.yml` in the root. It must:

- Trigger automatically on every commit to `main`
- Deploy **all** infrastructure and application code without any manual intervention
- Exit **0** only when the application is fully deployed and running
- Be **idempotent** — running it multiple times must not fail or duplicate resources

You are free to use any IaC tool (Terraform, CloudFormation, CDK, Bicep, Pulumi, Deployment Manager, etc.).

Minimum recommended structure:

```yaml
stages:
  - validate   # lint IaC, run tests
  - deploy     # provision infrastructure + deploy application

workflow:
  rules:
    - if: $CI_COMMIT_BRANCH == "main"
```

### Idempotency

The pipeline must be safe to run multiple times:

- Infrastructure applies must update existing resources, not fail because they already exist
- Database migrations must be additive and re-runnable
- Seed data scripts must check before inserting
- Resource names must be stable across runs

### IaC State (Terraform only)

Local state files are not compatible with CI/CD. If you use Terraform, configure a remote backend:

| Provider | Backend |
|---|---|
| AWS | S3 bucket + DynamoDB lock table |
| Azure | Azure Blob Storage |
| GCP | GCS bucket |

Bootstrap the state storage in the pipeline's first step, or in a one-time script before the first run. CloudFormation, CDK, Bicep, and Deployment Manager manage state natively and do not need this.

---

## What Is Not Allowed

| ❌ | ✅ |
|---|---|
| Manual cloud console steps after the pipeline | All steps automated in `.gitlab-ci.yml` |
| `when: manual` gate on any deploy job | Fully automatic deploy on `main` commit |
| Credentials hardcoded in code or pipeline | CI/CD variables only — never commit secrets |
| Pipeline exits 0 before the application is up | Wait/health-check step after infrastructure apply |

---

## Common Pitfalls

| Pitfall | Fix |
|---|---|
| Terraform state stored locally | Configure remote backend; bootstrap the bucket in the pipeline |
| Pipeline assumes `~/.aws/config` or local profiles | Use only env vars from CI variables — no local config assumptions |
| Hardcoded region or account ID | Use `$AWS_DEFAULT_REGION`, `$GOOGLE_REGION`, etc. |
| State bucket does not exist on first run | Bootstrap step that creates the bucket before `terraform init` |
| Deploy job exits 0 before resources are ready | Add health-check or wait step after `apply` |
| Wrong variable names | Double-check exact spelling against the table above |
