# AIDLC Prompt — E-Commerce Product Catalog

Using AI-DLC, build and deploy an E-Commerce Product Catalog on AWS.

## What to Build

A product catalog service for an online marketplace with ~50,000 products. Powers product browsing, full-text search with faceted filtering, and detail pages for customers. Includes a merchant admin interface for product management and bulk import. Must handle 10x traffic spikes during promotions.

## Core Features

1. Product CRUD API (name, description, price, images, attributes, category)
2. Nested category hierarchy (up to 3 levels)
3. Full-text search with relevance ranking (< 200ms p95)
4. Faceted filtering (price, category, brand, rating, availability)
5. Product detail pages with related recommendations
6. Merchant admin with bulk CSV import (10,000 products in < 10 minutes)
7. Product image management with automatic resizing
8. Inventory status tracking
9. Price history for analytics
10. Public API with rate limiting

## Constraints and Expectations

> **DevOps focus**: This project evaluates infrastructure skills. Use stubs or minimal implementations for front-end and back-end application code — just enough to validate the infrastructure works. Spend your effort on IaC, CI/CD, networking, security, and monitoring.

- All infrastructure defined as code (CloudFormation, CDK, or Terraform)
- CI/CD pipeline: code push triggers build, test, and deploy automatically
- ~200 req/sec normal, ~2,000 req/sec during promotions
- 95% reads, 5% writes — optimize for read-heavy patterns
- Cache invalidation strategy critical — stale prices are a business risk
- SEO: server-side or pre-rendered product pages
- Security: rate limiting, input validation, least-privilege IAM
- Basic monitoring: API latency, search performance, cache hit rates, error rates
- Include graceful cleanup in the solution, including deletion of all deployed resources

## What You Must Decide (and Justify)

- What database stores products with complex attributes and categories?
- What powers full-text search with faceted filtering? Same as primary DB or separate?
- How are product pages and search results cached? What's the invalidation strategy?
- How are images delivered globally?
- What runs the API, admin interface, and bulk import?
- How does the system scale for promotional traffic spikes?
- How does the CI/CD pipeline work?
