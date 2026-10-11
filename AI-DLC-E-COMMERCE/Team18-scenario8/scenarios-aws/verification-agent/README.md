# Verification Agent

## Overview

The Verification Agent is a Kiro custom agent that evaluates student team deployments. Given access to a team's repository and AWS account (via CLI session), it examines the infrastructure, code, and deployment, then conducts a structured interview focused on **why** decisions were made, not **how** things were implemented.

## Prerequisites

- Kiro IDE with custom agent support
- AWS CLI configured with read-only access to the student's AWS account
- Git access to the student's repository (cloned locally or accessible via URL)

## Setup

1. Copy `agent-prompt.md` to your Kiro custom agent configuration
2. Ensure AWS CLI is authenticated to the target account:
   ```bash
   aws sts get-caller-identity
   ```
3. Clone or open the student's repository in the workspace

## How It Works

The agent operates in four phases:

### Phase 0: Ownership Evidence Gate (AI-DLC decision trail)
- Locates the AI-DLC workspace under any accepted docs root (`aidlc/`, `_aidlc/`, `aidlc-docs/`, `.aidlc/`)
- Requires the signature triple that proves the framework actually ran: `aidlc-state.md` (stage plan + decision register), append-only `audit.md` (raw Q&A), and populated inception/construction artifact trees
- Judges *ownership quality* — are alternatives rejected with reasons, do rationales fit this scenario, does `audit.md` show real back-and-forth
- **Blocking**: no decision trail = the framework did not run = ownership cannot be assessed = not gradable, regardless of deployment quality

### Phase 1: Automated Discovery
- Scans the repository for IaC definitions, application code, CI/CD configuration
- Queries AWS account for deployed resources (CloudFormation stacks, running services, etc.)
- Maps the deployed infrastructure to the code in the repository

### Phase 2: Completeness Check
- Verifies all functional requirements from the scenario are implemented
- Checks that infrastructure is actually deployed and running (not just defined in code)
- Validates CI/CD pipeline exists and has execution history
- Checks for monitoring, logging, and alerting configuration

### Phase 3: Understanding Interview
- Generates questions focused on **why** (not how) for each architectural decision
- Questions are tailored to the specific choices the team made
- Covers: service selection rationale, trade-offs considered, cost implications, security decisions
- Produces a structured evaluation report

## Output

The agent produces a markdown evaluation report with:
- Infrastructure inventory (what was found)
- Completeness score per requirement
- Cost estimate for the deployed infrastructure
- List of interview questions with expected reasoning areas
- Overall assessment with strengths and areas for improvement

## Usage

Open the student's repository in Kiro, ensure AWS CLI access, then invoke the agent with:

```
Review this deployment for scenario [scenario-name]. The AWS account is accessible via the current CLI session.
```
