# Scenario 08: E-Commerce Product Catalog

## Title

E-Commerce Product Catalog

## AI-DLC Profile

**Module 2 — Classic.** Run this scenario with the **`classic`** profile (Standard depth). It starts at Inception and runs the established lifecycle through Construction and applicable Operation stages; minimal depth is not acceptable. A basic deploy is expected, but the full Operation phase (4.1–4.7) is not required.


## Description

Build a product catalog service for an online marketplace with ~50,000 products across 200 categories. The service powers product browsing, search, filtering, and detail pages for a customer-facing storefront. It also provides an admin interface for merchants to manage their product listings. The catalog must handle traffic spikes during promotional events.

## Functional Requirements

- Product management API: CRUD operations for products (name, description, price, images, attributes, category)
- Category hierarchy with nested subcategories (up to 3 levels deep)
- Full-text product search with relevance ranking
- Faceted filtering (by price range, category, brand, rating, availability)
- Product detail pages with related product recommendations
- Merchant admin interface for bulk product import (CSV upload of up to 10,000 products)
- Product image management (multiple images per product, automatic resizing)
- Inventory status tracking (in stock, low stock, out of stock)
- Price history tracking for analytics
- Public API with rate limiting for third-party integrations

## Infrastructure Expectations

Teams must deploy a fully working system on AWS. Key decisions the team should make and be prepared to justify:

- **Database**: What stores 50,000 products with complex attributes and category relationships? Why?
- **Search engine**: What powers full-text search with faceted filtering? Is it the same as the primary database?
- **Caching**: How are frequently accessed product pages and search results cached?
- **CDN**: How are product images and static assets delivered?
- **Compute**: What runs the API, admin interface, and bulk import jobs?
- **Infrastructure as Code**: All infrastructure must be defined in code and deployable from a pipeline
- **CI/CD**: Automated pipeline from code push to production deployment

## Additional Context

- ~50,000 products, ~200 categories, ~500 merchants
- Normal traffic: ~200 requests/second; promotional spikes: ~2,000 requests/second
- Search response time must be < 200ms at p95
- Bulk import should process 10,000 products within 10 minutes
- Product data changes ~5% daily (price updates, new listings, stock changes)
- Cache invalidation strategy matters — stale prices are a business risk
- Consider read-heavy access patterns: 95% reads, 5% writes
- SEO matters — product pages need server-side rendering or pre-rendering
