# Project Education for DevOps on AWS — AI-Assisted Scenarios

## Overview

This module contains 10 independent scenarios designed for teams that have completed the core DevOps on AWS course. Each scenario challenges a team to build and deploy a real application on AWS infrastructure using AI-driven development (AIDLC methodology).

## How It Works

1. **Each team receives one scenario** with a title, description, and additional instructions
2. **Teams use the AI-DLC v2 framework** (installed natively with `aidlc config --harness <harness>`; see [Getting Started](https://awslabs.github.io/aidlc-workflows/guide/01-getting-started/)) to design, build, and deploy the application
3. **AI assists but does not decide** — teams must understand and justify every architectural and infrastructure choice
4. **A verification agent** reviews the deployed result, examining the repository and AWS account to assess understanding and completeness

## Scenario Structure

Each scenario folder contains:

- `SCENARIO.md` — title, description, functional requirements, and infrastructure expectations
- `aidlc-prompt.md` — the intent to feed into the AI-DLC conductor, using the profile the scenario's `## AI-DLC Profile` section specifies (e.g. `/aidlc <profile> Follow ./aidlc-prompt.md`)

## Evaluation Criteria

The verification agent evaluates each deployment across these dimensions:

| Dimension | Weight | Focus |
|-----------|--------|-------|
| **Functionality** | 25% | Does the application work as described? |
| **Infrastructure Design** | 25% | Are service choices justified and appropriate? |
| **Cost Efficiency** | 15% | Is the infrastructure cost-conscious for the workload? |
| **Security Posture** | 15% | IAM least privilege, secrets management, network isolation |
| **Operational Readiness** | 10% | Monitoring, logging, alerting basics |
| **CI/CD Pipeline** | 10% | Automated build, test, deploy flow |

## Prerequisites

- Completed core DevOps on AWS course
- AWS account with appropriate permissions
- AI-DLC v2 framework installed (`aidlc` command) and configured into the project — see [SETUP.md](../SETUP.md) Step 7 and [Getting Started](https://awslabs.github.io/aidlc-workflows/guide/01-getting-started/)
- Familiarity with at least one IaC tool (CloudFormation, CDK, or Terraform)

## Scenarios at a Glance

| # | Scenario | Domain | Key AWS Decision Areas |
|---|----------|--------|----------------------|
| 1 | Community Event Board | Content platform | Compute, storage, CDN |
| 2 | Fleet Telemetry Ingestion | IoT / streaming | Ingestion, stream processing, time-series storage |
| 3 | Multi-Tenant SaaS Billing API | FinTech / SaaS | API management, data isolation, async processing |
| 4 | Image Processing Pipeline | Media / ML | Object storage, compute for processing, queuing |
| 5 | Internal Developer Portal | Platform engineering | Container orchestration, service discovery, auth |
| 6 | Real-Time Chat System | Communication | WebSockets, pub/sub, message persistence |
| 7 | Scheduled Compliance Reporter | Security / governance | Scheduled compute, data aggregation, notification |
| 8 | E-Commerce Product Catalog | Retail | Search, caching, database, CDN |
| 9 | CI/CD Platform for Microservices | DevOps tooling | Pipeline orchestration, artifact management, environments |
| 10 | Disaster Recovery Drill Simulator | Reliability engineering | Multi-region, backup/restore, failover |

## Test Data — "Where Do We Get Real Data?"

You don't need real data. Generating realistic test data is part of the exercise, and AI handles it well.

- **AIDLC generates seed data for you.** During the Construction phase, include "generate realistic seed data" in your prompt. The agent will create scripts that populate databases, generate test files, and simulate user activity.
- **For streaming and real-time scenarios** (Fleet Telemetry, Chat, etc.), the AI will write a data generator or simulator — for example, a script that emits GPS coordinates along a randomized route every 10 seconds, or a bot that sends messages at realistic intervals.
- **Realistic distributions matter more than real data.** A data generator that models bursty traffic patterns, peak hours, and edge cases demonstrates deeper system understanding than a static CSV import.
- **What is evaluated is architecture, infrastructure, and justification — not content quality.** Standard tools like Faker, seed scripts, and load generators are the expected approach.

Think of test data generation as part of the Inception phase: defining what data the system needs, what volumes and patterns to simulate, and how to populate the system for a realistic demo is a design decision in itself.

## Cost Efficiency

Cost of infrastructure ownership is one of the evaluation criteria. Teams are expected to make cost-conscious decisions and be able to justify them during the verification interview.

See [AWS Budget Guide](aws-budget-guide.md) for evaluator reference on cost assessment (this guide is for evaluators, not for students).

## Verification Agent

See `verification-agent/README.md` for setup and usage instructions.
