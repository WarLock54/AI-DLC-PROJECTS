# AWS Budget Guide for Scenario Deployments

## Purpose

This guide helps evaluators assess cost efficiency of student deployments. It is NOT provided to students — cost-conscious design is part of what they should demonstrate.

## Cost-Conscious AWS Services (Best Practices Reference)

### Compute
| Service | Cost-Effective When | Watch Out For |
|---------|-------------------|---------------|
| Lambda | Sporadic/bursty workloads, < 15 min execution | High-concurrency sustained loads, cold starts |
| Fargate | Steady containerized workloads, no cluster management needed | Over-provisioned task sizes |
| ECS on EC2 | Sustained workloads where you can optimize instance utilization | Under-utilized instances |
| EKS Autopilot | Kubernetes required, don't want to manage nodes | Control plane cost ($73/mo) even at low utilization |
| EKS Managed Nodes | Need specific instance types or GPU | Node group scaling lag, idle capacity |
| App Runner | Simple web apps, minimal config | Limited customization, cost at scale |

### Data Storage
| Service | Cost-Effective When | Watch Out For |
|---------|-------------------|---------------|
| DynamoDB On-Demand | Unpredictable traffic, low-to-moderate volume | High sustained throughput (provisioned cheaper) |
| DynamoDB Provisioned | Predictable, steady traffic | Over-provisioning, unused capacity |
| RDS (t3/t4g instances) | Relational data, burstable workloads | Running db.r5 for a dev workload |
| Aurora Serverless v2 | Variable database workloads | Minimum ACU cost even at idle |
| S3 Standard | Frequently accessed data | No lifecycle policies on growing data |
| S3 Infrequent Access | Data accessed < 1x/month | Retrieval fees on frequently accessed data |
| ElastiCache (t3 nodes) | Caching with predictable patterns | Over-sized cache nodes |

### Networking
| Service | Cost-Effective When | Watch Out For |
|---------|-------------------|---------------|
| CloudFront | Static content, global users | Origin shield costs, real-time logs |
| ALB | HTTP/HTTPS routing, multiple targets | Running ALB for a single target |
| API Gateway HTTP | Simple API proxy, Lambda integration | High-volume APIs (ALB may be cheaper) |
| API Gateway REST | Need API keys, usage plans, caching | Per-request pricing at high volume |
| NAT Gateway | Private subnet internet access required | $32/mo + data processing even at low usage |
| VPC Endpoints | Frequent AWS service API calls from VPC | Per-endpoint hourly cost |

### Messaging
| Service | Cost-Effective When | Watch Out For |
|---------|-------------------|---------------|
| SQS | Decoupled async processing | Long polling misconfiguration |
| SNS | Fan-out notifications | SMS/email delivery costs |
| EventBridge | Event routing, scheduling | Custom event bus at high volume |
| Kinesis Data Streams | Real-time streaming, ordering needed | Shard costs at low utilization |

### CI/CD
| Service | Cost-Effective When | Watch Out For |
|---------|-------------------|---------------|
| CodeBuild | On-demand builds | Large build instances left as default |
| CodePipeline | AWS-native pipeline | Per-pipeline monthly cost |
| GitHub Actions | Already using GitHub, generous free tier | Minutes overage on private repos |

## Common Cost Mistakes to Flag

1. **NAT Gateway for everything** — $32+/mo minimum. Consider VPC endpoints for AWS services, or whether resources truly need private subnets.
2. **Over-sized RDS instances** — A db.t3.micro handles many learning workloads. db.r5.large is rarely justified.
3. **Always-on compute for bursty workloads** — If traffic is sporadic, serverless or auto-scaling to zero is more appropriate.
4. **No S3 lifecycle policies** — Storage costs grow silently. Archival or expiration policies should exist.
5. **Multiple ALBs when one suffices** — Path-based routing can serve multiple services from one ALB.
6. **CloudWatch Logs without retention** — Default is infinite retention. Set appropriate retention periods.
7. **Unused Elastic IPs** — Charged when not attached to a running instance.
8. **EKS control plane for simple workloads** — $73/mo for the control plane alone. ECS or Fargate may be more appropriate.

## Estimated Monthly Cost Ranges by Scenario Complexity

These are rough ranges for well-designed deployments:

| Deployment Pattern | Expected Range | Red Flag If Above |
|-------------------|---------------|-------------------|
| Serverless (Lambda + DynamoDB + S3) | $5 - $30/mo | $100/mo |
| Container-based (Fargate + RDS) | $30 - $80/mo | $200/mo |
| EKS-based | $100 - $200/mo | $400/mo |
| Multi-region / HA | $150 - $300/mo | $500/mo |

**Note:** These ranges assume learning/demo workloads, not production traffic. Actual costs depend heavily on data volume and request rates.
