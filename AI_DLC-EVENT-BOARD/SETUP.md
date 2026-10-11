# Development Setup

## Requirements

- Windows, macOS, or Linux
- Node.js 22.x and npm
- Git
- AWS CLI and an AWS account only when deploying
- The `aidlc` runtime and GitHub Copilot for AI-DLC workflow sessions

## Install and validate

From the repository root:

```powershell
npm ci
npm run validate
```

To synthesize the CDK application without deploying it:

```powershell
$env:AWS_DEFAULT_REGION = "us-east-1"
npm run synth
```

`npm run validate` runs the configured build, lint, formatting, test, evidence-manifest, and security checks. See `package.json` for the full command list.

## AI-DLC setup

The repository already contains its AI-DLC workspace and GitHub Copilot integration. Do not remove or rename `AGENTS.md`, `.github/skills/aidlc/`, `.github/hooks/`, `.aidlc/`, or the `@` method imports in `AGENTS.md` when updating project documentation.

1. Install the AI-DLC runtime using its official installation instructions.
2. Open the repository in GitHub Copilot and run `/aidlc --doctor`.
3. Resolve any reported setup issues before starting a workflow.
4. Start project work with `/aidlc`; review and approve each workflow gate.

A new project intent should describe the current application and its requirements. Keep historical workflow audit records unchanged; if an old team record is not appropriate for a public repository, retain a private backup and start a separate solo intent rather than rewriting its audit trail.

## AWS credentials

Use the standard AWS credential chain for local work and protected CI variables for pipeline deployments. Set `AWS_DEFAULT_REGION` to the intended deployment region. Do not put credentials, access tokens, account IDs, or local profile details in source files or documentation.

Deployment can create billable AWS resources. Review the deployment and teardown guidance in [AUTO-DEPLOY.md](AUTO-DEPLOY.md) before running it.
