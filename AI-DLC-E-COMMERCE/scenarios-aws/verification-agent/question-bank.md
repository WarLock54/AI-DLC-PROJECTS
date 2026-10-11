# Verification Agent — Question Bank

This document provides a reference bank of "why" questions organized by AWS service category. The verification agent selects and adapts questions based on what it discovers in the student's deployment. These are templates — the agent must customize them with specific resource names, configurations, and context.

---

## Compute

### ECS Fargate vs ECS EC2
- "You chose Fargate over EC2 launch type. What operational burden does Fargate remove? When would EC2 launch type be the better choice?"
- "Your Fargate tasks are configured with [X] vCPU and [Y] memory. How did you determine these values? What's the cost impact of over-provisioning?"

### EKS vs ECS
- "You went with EKS for container orchestration. What capabilities does Kubernetes give you that ECS doesn't, and are you actually using them in this project?"
- "EKS has a control plane cost regardless of workload. How does that factor into your cost analysis for this scale?"

### EKS Autopilot vs Managed Node Groups
- "You're using EKS with managed node groups. Did you consider Autopilot? What control do managed nodes give you that Autopilot doesn't?"
- "Your node group uses [instance type]. How did you select that instance type for this workload?"

### Lambda vs Containers
- "You chose Lambda for [specific function]. What characteristics of this workload make it a good fit for serverless? What would make you move it to a container?"
- "Your Lambda has a [X] second timeout and [Y] MB memory. How did you arrive at these limits? What happens when the function hits them?"
- "Cold starts affect [specific function]. How does that impact user experience? What have you done to mitigate it?"

### EC2 vs Managed Services
- "You're running [service] on EC2 instead of using a managed AWS service. What drove that decision? What operational overhead does it create?"

---

## Data Storage

### DynamoDB vs RDS
- "Your data is in DynamoDB. Walk me through the access patterns that made a key-value store the right choice over a relational database."
- "You designed your DynamoDB table with [partition key] and [sort key]. Why this key design? What queries does it optimize for, and what queries become expensive?"
- "You're using on-demand capacity mode. At what request volume would provisioned capacity become cheaper?"

### RDS Engine Selection
- "You chose [PostgreSQL/MySQL/Aurora]. What specific features of this engine does your application depend on?"
- "Your RDS instance is [instance class] with [storage type]. How did you size it for this workload?"
- "Is your RDS instance Multi-AZ? Why or why not? What's the cost and availability trade-off?"

### Aurora vs Standard RDS
- "You chose Aurora over standard RDS. What does Aurora give you that justifies the price difference for this workload?"
- "Aurora Serverless v2 scales automatically. How does that compare to your current fixed-size approach in terms of cost and performance?"

### S3 Storage Classes and Lifecycle
- "Your S3 bucket uses [storage class]. Is that the right class for the access pattern? How often is this data accessed?"
- "I don't see lifecycle policies on [bucket]. What happens to storage costs as data accumulates over months?"
- "You're using S3 for [specific purpose]. Did you consider [alternative]? What made S3 the right fit?"

### ElastiCache / Redis vs Application-Level Caching
- "You added a Redis cache for [specific use case]. What's the cache hit rate you're targeting? How do you handle cache invalidation?"
- "What happens if the cache goes down? Does the application degrade gracefully or fail?"

### Timestream vs DynamoDB for Time-Series
- "You're storing time-series data in [service]. What query patterns drove that choice? How does it handle data retention and aggregation?"

---

## Networking and Content Delivery

### CloudFront
- "You're using CloudFront for [specific content]. What's your cache policy? How do you handle cache invalidation when content changes?"
- "Your CloudFront distribution has [specific origin]. Why that origin type?"

### ALB vs NLB vs API Gateway
- "You chose [ALB/NLB/API Gateway] for traffic routing. What features of that service does your architecture depend on?"
- "Your load balancer is [internet-facing/internal]. Why that choice? What's the security implication?"

### VPC Design
- "Walk me through your VPC design. Why [X] subnets across [Y] AZs? What's in public vs. private subnets and why?"
- "You have a NAT Gateway in your architecture. What resources need it? What does it cost monthly? Are there alternatives?"

### API Gateway vs ALB for APIs
- "You're using API Gateway instead of putting an ALB in front of your containers. What does API Gateway give you that an ALB doesn't for this use case?"
- "Your API Gateway is [REST/HTTP/WebSocket]. Why that type? What are the cost and feature differences?"

---

## Messaging and Event Processing

### SQS vs SNS vs EventBridge
- "You're using [SQS/SNS/EventBridge] for [specific purpose]. What characteristics of this communication pattern made it the right choice?"
- "Your SQS queue has a visibility timeout of [X] seconds and a dead-letter queue after [Y] retries. How did you determine these values?"

### Kinesis vs SQS for Streaming
- "You chose [Kinesis/SQS] for data ingestion. What throughput and ordering requirements drove that decision?"
- "Your Kinesis stream has [X] shards. How did you calculate the shard count? What happens during traffic spikes?"

### Step Functions vs Custom Orchestration
- "You built a custom workflow orchestrator instead of using Step Functions. What limitations of Step Functions led to that decision?"
- "Your Step Functions workflow has [X] states. How do you handle failures mid-workflow? What's the retry strategy?"

---

## CI/CD and Deployment

### Pipeline Tool Selection
- "You chose [CodePipeline/GitHub Actions/other] for CI/CD. What capabilities influenced that choice?"
- "Your pipeline has [X] stages. Walk me through why each stage exists and what it catches."

### Deployment Strategy
- "You're using [rolling/blue-green/canary] deployment. Why that strategy for this application? What's the rollback procedure?"
- "How long does a deployment take end-to-end? What's the blast radius if a bad deployment gets through?"

### IaC Tool Selection
- "You chose [CloudFormation/CDK/Terraform] for infrastructure. What drove that decision? What are the trade-offs vs. alternatives?"
- "How do you handle infrastructure changes that require resource replacement? What's your strategy for zero-downtime infrastructure updates?"

---

## Security

### IAM Design
- "Walk me through the IAM roles in this deployment. How did you determine the minimum permissions each role needs?"
- "I see [specific role] has [specific broad permission]. Why does it need that? Could it be scoped more narrowly?"

### Secrets Management
- "How do secrets get from [Secrets Manager/Parameter Store/other] into the running application? Walk me through the flow."
- "I see [specific secret handling pattern]. What's the rotation strategy? What happens when a secret is rotated?"

### Network Security
- "Your security groups allow [specific rule]. Why is that access needed? What's the risk if it were more restrictive?"
- "How is traffic encrypted between [component A] and [component B]? Is it TLS everywhere?"

### Data Protection
- "Your [S3 bucket/database/etc.] uses [encryption type]. Why that encryption approach? Who manages the keys?"
- "What happens to data when a resource is deleted? Is there a data retention or backup policy?"

---

## Monitoring and Operations

### Observability
- "What metrics are you monitoring for [specific service]? Why those metrics and not others?"
- "Your CloudWatch alarm triggers at [threshold]. How did you determine that threshold? What's the false positive rate?"
- "Walk me through what happens when an alarm fires. Who gets notified? What's the expected response?"

### Logging
- "Your log retention is set to [X] days. Why that duration? What compliance or debugging needs does it serve?"
- "How would you trace a single user request through all the services in this architecture?"

### Incident Response
- "It's 3 AM and [specific service] is returning errors. How do you know? What's your first debugging step?"
- "A deployment broke production. How do you roll back? How long does it take?"
- "Your [database/service] is running at 90% capacity. How do you know before it hits 100%? What's the scaling plan?"

---

## Cost

### Overall Architecture Cost
- "Walk me through the monthly cost of this deployment. What are the top 3 cost drivers?"
- "If traffic doubles, how does cost scale? Is it linear, sub-linear, or super-linear?"
- "If the budget were cut by 50%, what would you change? What would you refuse to cut?"

### Specific Service Costs
- "Your NAT Gateway processes [X] GB/month. What does that cost? Are there cheaper alternatives?"
- "You're running [service] 24/7. Does the workload justify always-on? Could scheduled scaling reduce costs?"
- "Your [database] is provisioned for peak load. What percentage of the time is it actually at peak? Would auto-scaling or serverless be more cost-effective?"

### Cost Optimization Awareness
- "Are you using any Reserved Instances or Savings Plans? Why or why not for this workload?"
- "What S3 storage class are you using? Is it the most cost-effective for the access pattern?"
- "How do you prevent cost surprises? Are there billing alarms or budgets configured?"
