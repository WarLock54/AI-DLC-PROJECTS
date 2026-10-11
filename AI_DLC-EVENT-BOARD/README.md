# Community Event Board

A serverless community events application built with TypeScript, AWS CDK v2, and Node.js 22. **Current project owner and maintainer: Onur.** The application supports public event discovery, organizer/admin workflows, RSVP and waitlisting, reminders, statistics, and archival.

## Architecture and documentation

- [Architecture](docs/architecture.md)
- [Integration contracts](docs/contracts.md)
- [Architecture decisions](docs/decisions.md)
- [Release and deployment guide](AUTO-DEPLOY.md)
- [Local setup](SETUP.md)
- [Verification](VERIFICATION.md)

The backend and infrastructure are under `src/`; the web UI is under `ui/`; automated tests are under `test/`; operational utilities are under `scripts/`.

## Quick start

Requirements: Node.js 22.x and npm. From the repository root:

```powershell
npm ci
npm run validate
$env:AWS_DEFAULT_REGION = "us-east-1"
npm run synth
```

`synth` validates and synthesizes the CDK application; it does not deploy resources. See [SETUP.md](SETUP.md) before configuring AWS credentials or deploying.

## AI-DLC

This repository includes the AI-DLC workflow integration for GitHub Copilot. `AGENTS.md` and `.github/skills/aidlc/` provide the harness instructions; `.aidlc/` contains the framework runtime, and `aidlc/` contains project workflow records and rules. Keep the framework and its import wiring intact when customizing project guidance.

Run `/aidlc --doctor` in Copilot to check the local workflow setup. Use `/aidlc` to start or continue work and approve workflow gates yourself.

## Deployment and secrets

The current deployment pipeline is GitLab CI, configured in `.gitlab-ci.yml`. Deployment requires AWS credentials and a region supplied through the approved local credential chain or CI variables. Never commit credentials, tokens, or account-specific secrets. See [AUTO-DEPLOY.md](AUTO-DEPLOY.md).
