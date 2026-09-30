# Enterprise Office ERP — System Architecture

**Document:** ARCHITECTURE.md  
**Version:** 1.0  
**Status:** Baseline / Build Source  
**Companion:** PRD.md  
**Primary source:** Project master ERP specification (`CLAUDE.md`)  
**Audience:** Solution architects, senior engineers, DevOps, security, QA, AI coding agents

> This document converts the product requirements into an implementation architecture. The existing project specification remains the source of truth for product scope, required workflows, security expectations, accounting behavior, UI, testing, and delivery.

---

# 1. Architecture Goals

The ERP is designed as a **production-grade modular monolith** with strong domain boundaries.

The architecture must provide:

- Multi-company support
- Multi-branch support
- Department and warehouse scoping
- Strong server-side authorization
- Configurable workflows and approvals
- Accounting integrity
- Inventory integrity
- Payroll integrity
- Complete auditability
- Reliable asynchronous processing
- Real-time capabilities where useful
- Secure document storage
- Extensible integrations
- Professional responsive UI
- Automated testing
- Operational observability
- A path to future service extraction without prematurely introducing microservices

The project specification explicitly requires clean domain boundaries and says not to add unnecessary microservices during the first implementation.

---

# 2. Architectural Style

## 2.1 Primary architecture

```text
                         ┌──────────────────────────┐
                         │       Web / Mobile       │
                         │     Next.js + React      │
                         └────────────┬─────────────┘
                                      │
                             HTTPS / WebSocket
                                      │
                         ┌────────────▼─────────────┐
                         │       API / BFF Layer     │
                         │          NestJS           │
                         └────────────┬─────────────┘
                                      │
                 ┌────────────────────┼────────────────────┐
                 │                    │                    │
        ┌────────▼────────┐  ┌────────▼────────┐  ┌───────▼────────┐
        │ Domain Modules  │  │ Platform Modules│  │ Integration    │
        │ HR / Payroll    │  │ Auth / RBAC     │  │ Adapters       │
        │ Procurement     │  │ Workflow        │  │ Email/SMS/etc. │
        │ Inventory       │  │ Notifications   │  │ Payments       │
        │ Sales           │  │ Audit           │  │ Storage        │
        │ Accounting      │  │ Documents       │  │ Biometrics     │
        └────────┬────────┘  └────────┬────────┘  └───────┬────────┘
                 │                    │                    │
                 └────────────────────┼────────────────────┘
                                      │
                         ┌────────────▼─────────────┐
                         │       Domain Services    │
                         │ Rules / Transactions /   │
                         │ Policies / Posting       │
                         └────────────┬─────────────┘
                                      │
                  ┌───────────────────┼───────────────────┐
                  │                   │                   │
         ┌────────▼────────┐ ┌────────▼────────┐ ┌───────▼────────┐
         │   PostgreSQL    │ │      Redis      │ │ Object Storage │
         │ Prisma ORM     │ │ BullMQ / Cache  │ │ S3-compatible  │
         └─────────────────┘ └─────────────────┘ └────────────────┘
```

The implementation is one deployable application boundary initially, but internally separated into domain modules.

---

# 3. Technology Baseline

## 3.1 Frontend

Required baseline:

- Next.js
- React
- TypeScript
- Tailwind CSS
- shadcn/ui or equivalent accessible component system
- TanStack Query
- React Hook Form
- Zod
- Recharts or equivalent
- WebSocket client

Responsibilities:

- Rendering
- Navigation
- Forms
- Client-side validation for UX
- Query/mutation state
- Optimistic behavior only where safe
- Real-time UI updates
- Accessibility
- Responsive layouts

The frontend must never be treated as the security boundary.

---

# 4. Backend

Required baseline:

- NestJS
- TypeScript
- REST APIs
- WebSockets
- PostgreSQL
- Prisma ORM
- Redis
- BullMQ or equivalent
- Object-storage abstraction

Backend responsibilities:

- Authentication
- Authorization
- Business rules
- Workflow state transitions
- Accounting posting
- Inventory transactions
- Payroll calculations
- Audit events
- Data validation
- Transaction management
- Integration orchestration
- Background jobs
- Search authorization
- Reporting data access

All security-sensitive decisions are server-side.

---

# 5. Infrastructure

Development and deployment architecture:

```text
Docker Compose
├── web / frontend
├── api / backend
├── worker
├── postgres
├── redis
└── object-storage-compatible service
```

Production infrastructure should preserve the same logical boundaries while allowing independent scaling.

Required infrastructure capabilities:

- PostgreSQL
- Redis
- S3-compatible object storage
- Reverse proxy
- CI/CD
- Automated database backups
- Centralized structured logging

---

# 6. Repository Structure

Recommended monorepo:

```text
erp/
├── apps/
│   ├── web/
│   │   ├── app/
│   │   ├── components/
│   │   ├── features/
│   │   ├── hooks/
│   │   ├── lib/
│   │   ├── providers/
│   │   └── styles/
│   │
│   ├── api/
│   │   ├── src/
│   │   │   ├── modules/
│   │   │   ├── common/
│   │   │   ├── config/
│   │   │   ├── database/
│   │   │   ├── guards/
│   │   │   ├── interceptors/
│   │   │   └── main.ts
│   │   └── test/
│   │
│   └── worker/
│       ├── src/
│       │   ├── jobs/
│       │   ├── processors/
│       │   └── main.ts
│       └── test/
│
├── packages/
│   ├── ui/
│   ├── config/
│   ├── types/
│   ├── validation/
│   ├── permissions/
│   ├── accounting/
│   ├── workflows/
│   └── events/
│
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed/
│
├── docs/
│   ├── PRD.md
│   ├── ARCHITECTURE.md
│   ├── DATA-MODEL.md
│   ├── USER-FLOWS.md
│   └── UI-UX.md
│
├── scripts/
├── docker/
├── .github/
├── docker-compose.yml
├── package.json
├── pnpm-workspace.yaml
└── CLAUDE.md
```

The exact package manager and workspace tooling may follow the existing repository if one already exists. If starting empty, the monorepo approach should be established before feature development.

---

# 7. Domain Module Boundaries

Each business domain owns its own:

- Controllers
- Services
- Domain models
- Validation
- Policies
- Workflow handlers
- Events
- Tests

Core modules:

```text
platform/
├── identity
├── authorization
├── organizations
├── settings
├── numbering
├── audit
├── documents
├── notifications
├── workflows
├── events
└── search

business/
├── hr
├── attendance
├── leave
├── payroll
├── procurement
├── inventory
├── sales
├── fixed-assets
├── accounting
├── office
├── communication
└── reporting
```

Modules communicate through explicit application services, domain events, or stable interfaces rather than directly manipulating another module's internal data.

---

# 8. Dependency Direction

The preferred dependency direction is:

```text
Presentation
    ↓
Application
    ↓
Domain
    ↓
Infrastructure
```

A module should not allow:

```text
Controller → Prisma directly
Controller → another module's database tables
Frontend → database
Frontend → accounting internals
```

Instead:

```text
Controller
   ↓
Application Service
   ↓
Domain Policy / Service
   ↓
Repository / Infrastructure
```

Cross-module operations should use explicit contracts.

---

# 9. Module Contract Pattern

Every substantial module should follow a predictable structure:

```text
module-name/
├── controllers/
├── dto/
├── entities/
├── domain/
├── application/
├── repositories/
├── policies/
├── events/
├── integrations/
├── module.ts
└── tests/
```

Example:

```text
accounting/
├── controllers/
│   ├── journal.controller.ts
│   ├── ledger.controller.ts
│   └── periods.controller.ts
├── dto/
├── domain/
│   ├── journal.ts
│   ├── posting.ts
│   └── period.ts
├── application/
│   ├── post-journal.service.ts
│   ├── reverse-journal.service.ts
│   └── close-period.service.ts
├── repositories/
├── policies/
├── events/
└── tests/
```

---

# 10. API Architecture

Use versioned REST APIs.

Example:

```text
/api/v1/auth
/api/v1/organizations
/api/v1/users
/api/v1/roles
/api/v1/hr/employees
/api/v1/attendance
/api/v1/leave
/api/v1/payroll
/api/v1/procurement
/api/v1/inventory
/api/v1/sales
/api/v1/accounting
/api/v1/assets
/api/v1/office
/api/v1/documents
/api/v1/notifications
/api/v1/reports
```

## 10.1 API conventions

Every endpoint should have:

- Authentication requirement
- Permission requirement
- Scope requirement where applicable
- DTO validation
- Consistent error format
- Request correlation ID
- Audit behavior where sensitive
- Pagination for collections
- Filtering where required
- Sorting where required

---

# 11. API Response Model

Use a consistent response contract.

Example:

```json
{
  "data": {},
  "meta": {
    "requestId": "..."
  }
}
```

Paginated:

```json
{
  "data": [],
  "meta": {
    "page": 1,
    "pageSize": 25,
    "total": 250,
    "requestId": "..."
  }
}
```

Errors should expose safe machine-readable codes without leaking internal implementation details.

---

# 12. Authentication Architecture

Authentication requirements:

- Secure password hashing
- Session management
- Access-token/JWT strategy appropriate to the deployment
- Refresh-token rotation if used
- MFA abstraction
- Account lock controls
- Rate limiting
- Secure session invalidation
- Login audit events

Authentication establishes identity.

Authorization independently determines what that identity can do.

---

# 13. Authorization Architecture

Permission model:

```text
module
resource
action
scope
```

Examples:

```text
accounting.invoice.post
accounting.invoice.reverse
payroll.payroll_run.approve
inventory.stock.adjust
purchase.purchase_order.approve
```

Supported action concepts include:

```text
view
create
edit
delete
submit
approve
reject
post
reverse
cancel
export
print
upload
download
assign
transfer
reconcile
```

Scopes:

```text
own
department
branch
company
all
```

Authorization must evaluate:

```text
Authenticated User
      +
Role / Permission
      +
Requested Action
      +
Resource
      +
Company Scope
      +
Branch Scope
      +
Department Scope
      +
Warehouse Scope
```

A UI permission check is only a usability feature. The API must enforce the same rule.

---

# 14. Multi-Company / Multi-Branch Architecture

Organization hierarchy:

```text
Company
├── Branch
│   ├── Department
│   ├── Warehouse
│   ├── Cost Centers
│   └── Users / Employees
└── Branch
```

Transactional records should carry applicable dimensions:

```text
company_id
branch_id
department_id
cost_center_id
warehouse_id
project_id
created_by
updated_by
created_at
updated_at
```

The architecture must never assume one company or one branch.

Scope resolution should happen centrally so modules do not each implement slightly different authorization logic.

---

# 15. Request Context

Every authenticated request should establish a request context containing applicable information such as:

```text
requestId
userId
companyScope
branchScope
departmentScope
warehouseScope
locale
timezone
permissions
```

The request context should be available to:

- Authorization guards
- Services
- Audit
- Logging
- Query policies
- Notification generation
- Reporting

The context must not be trusted when supplied directly by the client; it is derived from authenticated identity and server-side configuration.

---

# 16. Database Architecture

PostgreSQL is the authoritative transactional database.

Prisma is the ORM and schema/migration tool.

Database design must prioritize:

1. Referential integrity
2. Financial integrity
3. Transaction consistency
4. Explicit relationships
5. Proper indexes
6. Auditability
7. Scope-aware queries
8. Historical preservation

Use database constraints wherever a rule can be safely enforced at the database layer.

Examples:

- Foreign keys
- Unique constraints
- Not-null constraints
- Check constraints where appropriate
- Composite uniqueness for scoped records

---

# 17. Transaction Boundaries

Any operation that changes multiple related financial or operational records must use a database transaction.

Example:

```text
Post Supplier Invoice
        │
        ├── Invoice status
        ├── AP transaction
        ├── Tax transaction
        ├── Inventory effect where applicable
        ├── GL journal
        ├── Source references
        └── Audit event
```

These operations must not leave partial state.

The same principle applies to:

- Sales invoice posting
- Receipt posting
- Payment posting
- Payroll posting
- Inventory adjustments
- Asset capitalization
- Asset disposal
- Period close

---

# 18. Accounting Architecture

Accounting is a first-class domain, not a reporting afterthought.

Core components:

```text
Accounting
├── Chart of Accounts
├── Journals
├── Journal Lines
├── Posting
├── Reversal
├── Financial Periods
├── General Ledger
├── Accounts Receivable
├── Accounts Payable
├── Cash
├── Bank
├── Tax
├── Reconciliation
└── Financial Statements
```

Operational modules request controlled accounting actions.

Example:

```text
Sales
  ↓
Invoice Posting Service
  ↓
Accounting Posting Engine
  ↓
Journal
  ↓
Journal Lines
  ↓
GL / AR / Tax
```

The operational module should not construct arbitrary journal rows independently.

---

# 19. Accounting Posting Engine

The posting engine should validate:

- Source document status
- Required accounting configuration
- Financial period
- Account validity
- Currency requirements
- Tax requirements
- Debit/credit balance
- Duplicate posting prevention
- Reversal rules
- Authorization

Posting should produce an immutable financial record.

Correction occurs through:

```text
Original Transaction
        ↓
Controlled Reversal / Credit / Debit / Adjustment
```

not silent mutation of posted history.

---

# 20. Idempotency

Operations that can be retried must be designed to avoid duplicate effects.

Examples:

- Payment processing
- External webhooks
- Notification delivery
- Background jobs
- Invoice posting commands
- Receipt posting
- Integration imports

Use stable idempotency keys or source references where appropriate.

An operation repeated with the same valid idempotency key should not create duplicate financial consequences.

---

# 21. Event Architecture

Use domain/application events for decoupling.

Example:

```text
PurchaseOrderApproved
        ↓
Notification
        ↓
Procurement reporting
        ↓
Integration adapter
```

Another:

```text
SalesInvoicePosted
        ↓
Accounting effect
        ↓
AR update
        ↓
Notification
        ↓
Reporting refresh
```

Events should describe completed business facts rather than arbitrary implementation actions.

Example:

```text
EmployeeCreated
PayrollRunApproved
PurchaseOrderApproved
GoodsReceiptPosted
SalesInvoicePosted
PaymentPosted
JournalReversed
```

---

# 22. Reliable Asynchronous Processing

Redis + BullMQ or equivalent is used for background work.

Good candidates:

- Email
- SMS
- WhatsApp delivery
- Large report generation
- Export generation
- Document processing
- Scheduled notifications
- Integration synchronization
- Non-critical recalculation
- Long-running imports

Workers must support:

- Retry
- Backoff
- Failure handling
- Dead-letter/failure inspection
- Job identifiers
- Structured logs
- Idempotency

Financial posting should not be moved to an asynchronous job merely to make the UI faster if doing so would compromise transactional consistency.

---

# 23. Recommended Reliability Enhancement: Transactional Outbox

**Architecture recommendation:** when an important database transaction must trigger asynchronous work, use an outbox record committed in the same database transaction.

Example:

```text
Database Transaction
├── Business Transaction
├── Audit Record
└── Outbox Event
          ↓
      Outbox Worker
          ↓
     Redis / BullMQ
          ↓
External / Async Consumer
```

This prevents a successful database commit from being followed by a lost event because the application crashed before enqueueing it.

This is an architectural enhancement recommended for production reliability; it should be introduced where event delivery consistency matters.

---

# 24. Workflow Engine

Workflow is a reusable platform capability.

Generic lifecycle:

```text
DRAFT
  ↓
SUBMITTED
  ↓
UNDER_REVIEW
  ├── REJECTED
  ├── RETURNED
  └── APPROVED
          ↓
       POSTED
          ↓
      COMPLETED
```

Not every module needs every state.

Workflow definitions should support:

- Conditions
- Amount thresholds
- Roles
- Scope
- Sequential approvals
- Parallel approvals where needed
- Delegation
- Escalation
- Notifications
- Approval history
- SLA/overdue tracking

The workflow engine must not bypass domain validation.

---

# 25. State Machine Rules

Business documents should have explicit state transitions.

Example:

```text
Purchase Order

DRAFT
  → SUBMITTED
  → APPROVED
  → PARTIALLY_RECEIVED
  → FULLY_RECEIVED
  → CLOSED
```

Invalid transitions must be rejected server-side.

Each transition should define:

- Actor permission
- Preconditions
- Side effects
- Audit event
- Notifications
- Accounting effects where applicable

---

# 26. Document Architecture

Documents and attachments use object storage through an abstraction.

Logical flow:

```text
User
 ↓
API Authorization
 ↓
Document Service
 ↓
Metadata in PostgreSQL
 ↓
Binary in Object Storage
```

Database stores:

- Document ID
- Owner/resource
- Storage key
- Filename
- MIME type
- Size
- Hash where required
- Version
- Access metadata
- Created by
- Created at

Object storage contains the actual binary.

---

# 27. File Security

File access must be authorization-aware.

Do not expose unrestricted object-storage URLs.

Use controlled access mechanisms such as:

- Authorized download endpoints
- Short-lived signed URLs
- Permission checks before issuing access

Sensitive documents must inherit or explicitly define access rules.

---

# 28. Notification Architecture

Central notification service:

```text
Business Event
      ↓
Notification Rule
      ↓
Template
      ↓
Preference Check
      ↓
Channel Adapter
 ┌────┼────┬────┐
Web  Email SMS WhatsApp
```

Channel adapters should isolate external provider APIs.

Required properties:

- Retry
- Delivery status
- Template version
- User preferences
- Auditability where appropriate

---

# 29. Integration Architecture

External integrations must use adapters/interfaces.

```text
Domain
  ↓
Integration Interface
  ↓
Provider Adapter
  ↓
External Provider
```

Examples:

```text
EmailProvider
SMSProvider
WhatsAppProvider
PaymentProvider
BiometricProvider
BankStatementProvider
ObjectStorageProvider
```

The domain must not import a provider SDK directly.

This allows:

- Provider replacement
- Testing with fake adapters
- Development implementations
- Multiple providers
- Reduced vendor lock-in

---

# 30. Search Architecture

Global search is a platform service.

Searchable resources may include:

- Employees
- Customers
- Suppliers
- Products
- Documents
- Purchase documents
- Sales documents
- Financial documents
- Transactions

Search must apply authorization and scope filters before returning results.

Do not build an unrestricted global search index that leaks inaccessible records.

---

# 31. Reporting Architecture

Reports should consume authoritative backend data.

```text
Operational Modules
       ↓
Accounting / Transaction Data
       ↓
Reporting Queries / Services
       ↓
Dashboard / Report API
       ↓
Web UI / Export
```

Reports must not reconstruct accounting balances from frontend state.

Large exports should run asynchronously.

---

# 32. Real-Time Architecture

WebSockets may be used for:

- Notifications
- Chat
- Approval updates
- Job status
- Dashboard refresh events
- Collaboration features

Real-time connections must authenticate the user and respect authorization.

Do not broadcast sensitive events to an entire organization by default.

---

# 33. Caching

Redis may be used for:

- Short-lived cache
- Session-related infrastructure where applicable
- Rate limiting
- Job queues
- Temporary computation state

Do not cache mutable financial truth in a way that can become the authoritative source.

Cache invalidation should be explicit for important business data.

---

# 34. Configuration Architecture

Configuration should be separated into:

### Environment secrets

```text
DATABASE_URL
REDIS_URL
OBJECT_STORAGE_ENDPOINT
OBJECT_STORAGE_BUCKET
OBJECT_STORAGE_ACCESS_KEY
OBJECT_STORAGE_SECRET_KEY
JWT_SECRET
```

### Application configuration

- Company settings
- Numbering
- Workflow rules
- Tax configuration
- Payroll configuration
- Notification configuration

Secrets must never be stored in source control.

---

# 35. Time, Currency and Localization

Because the ERP is multi-company and multi-branch:

- Store timestamps consistently
- Store the applicable timezone configuration
- Convert for presentation
- Never infer business date from browser locale alone
- Store currency explicitly on financial entities
- Avoid floating-point arithmetic for monetary calculations
- Use appropriate decimal/database numeric types
- Define rounding rules centrally

Branch-specific attendance and holiday rules must use the applicable branch/time-zone configuration.

---

# 36. Monetary Precision

Financial amounts must use exact decimal arithmetic.

Avoid:

```text
JavaScript Number
```

for authoritative financial calculations.

Use:

- PostgreSQL numeric/decimal
- Decimal-aware application libraries
- Explicit currency precision
- Explicit rounding rules

The same rule applies to:

- Payroll
- Tax
- Inventory valuation
- AR/AP
- GL
- Asset depreciation

---

# 37. Audit Architecture

Audit logging is a cross-cutting platform service.

Audit events should capture relevant information such as:

```text
actor
action
resource
resource_id
timestamp
request_id
company
branch
before/after where appropriate
reason where required
metadata
```

Audit sensitive actions including:

- Permission changes
- Employee changes
- Payroll changes
- Financial posting
- Financial reversal
- Inventory adjustments
- Document access
- Approvals
- Configuration changes
- Integrations
- Exports

Audit records must themselves be protected against unauthorized modification.

---

# 38. Observability

The application should provide:

- Structured logs
- Request IDs
- Correlation IDs
- Error tracking abstraction
- Health endpoint
- Readiness endpoint
- Database health
- Redis health
- Queue health
- Job identifiers
- API latency measurements
- Background-job failure visibility

Example request flow:

```text
Browser
 ↓ requestId
Reverse Proxy
 ↓
NestJS
 ↓ correlationId
Domain Service
 ↓
PostgreSQL / Redis
```

Logs must not expose passwords, tokens, secrets, or sensitive personal information unnecessarily.

---

# 39. Error Handling

Use centralized error handling.

Errors should distinguish:

```text
Authentication
Authorization
Validation
Not Found
Conflict
Business Rule Violation
Financial Posting Error
Integration Error
Infrastructure Error
Unexpected Error
```

Clients receive safe error messages and machine-readable codes.

Internal logs retain diagnostic details.

---

# 40. Concurrency and Locking

Critical financial and inventory operations must account for concurrent requests.

Potential contention includes:

- Inventory balance updates
- Number generation
- Payment allocation
- Payroll runs
- Period closing
- Financial posting
- Stock transfers

Use appropriate PostgreSQL transaction isolation and row-level locking where required.

Never rely on:

```text
Read balance
→ calculate
→ write balance
```

without considering concurrent transactions.

---

# 41. Numbering Architecture

Document numbering should be centralized.

Examples:

```text
PR-2026-000001
PO-2026-000001
GRN-2026-000001
INV-2026-000001
PAY-2026-000001
JE-2026-000001
```

Numbering may depend on:

- Company
- Branch
- Document type
- Financial year
- Prefix
- Sequence

The implementation must be concurrency-safe.

---

# 42. Database Indexing Strategy

Indexes should follow actual access patterns.

Important candidates include:

```text
company_id
branch_id
department_id
warehouse_id
status
created_at
updated_at
document_number
employee_id
customer_id
supplier_id
product_id
financial_period_id
```

Use composite indexes where common queries filter by multiple scope dimensions.

Do not create indexes blindly; validate important indexes against query plans.

---

# 43. Soft Delete and Historical Records

Soft deletion should be used only where it makes business sense.

For master data:

```text
active / inactive
```

may be preferable to physical deletion.

Financial transactions should generally remain historically preserved.

Posted records must not be silently deleted.

---

# 44. API Security

Apply:

- Authentication
- Authorization guards
- DTO validation
- Rate limiting
- Payload limits
- Safe serialization
- CORS policy
- CSRF protection where applicable
- Secure headers
- IDOR/BOLA prevention
- File access control

Every resource lookup must verify that the authenticated user is authorized to access that resource.

---

# 45. Frontend Architecture

Recommended feature organization:

```text
apps/web/
├── app/
├── components/
│   ├── ui/
│   ├── forms/
│   ├── tables/
│   ├── dialogs/
│   └── layout/
├── features/
│   ├── auth/
│   ├── hr/
│   ├── payroll/
│   ├── procurement/
│   ├── inventory/
│   ├── sales/
│   ├── accounting/
│   └── ...
├── hooks/
├── lib/
├── providers/
└── styles/
```

Business rules remain on the server.

The frontend can provide:

- UX validation
- Formatting
- Filtering
- Presentation
- Navigation
- Permission-aware UI

but cannot be trusted for enforcement.

---

# 46. Data Fetching

TanStack Query should manage server state.

Use:

- Query keys
- Cache policies
- Mutation invalidation
- Pagination
- Prefetching where useful
- Error handling

Avoid uncontrolled global state for server data.

---

# 47. Forms

Forms should use:

```text
React Hook Form
+
Zod
```

Client validation improves UX.

Server DTO validation remains authoritative.

Forms must support:

- Draft preservation where appropriate
- Validation errors
- Server errors
- Unsaved-change warnings
- Loading states
- Submission state
- Accessible labels and errors

---

# 48. UI State Model

Every important page should consider:

```text
Loading
Loaded
Empty
Error
Unauthorized
Forbidden
Submitting
Success
Conflict
```

Do not ship blank or broken states.

---

# 49. Testing Architecture

Testing layers:

```text
Unit
  ↓
Integration
  ↓
API
  ↓
Permission
  ↓
Workflow
  ↓
Accounting Posting
  ↓
End-to-End
```

Critical flows must have E2E tests.

Minimum critical journeys:

```text
Procure-to-Pay
Quote-to-Cash
Hire-to-Pay
Asset Lifecycle
```

---

# 50. Permission Testing

Permission tests must verify both:

1. The user can perform permitted operations.
2. The user cannot perform unauthorized operations.

Test combinations of:

```text
Role
+
Action
+
Company
+
Branch
+
Department
+
Warehouse
```

Never test only the presence/absence of frontend buttons.

---

# 51. Migration Strategy

Every database change must use a versioned migration.

Workflow:

```text
Change Prisma schema
        ↓
Generate migration
        ↓
Review migration
        ↓
Run migration
        ↓
Run tests
        ↓
Verify rollback/recovery strategy where applicable
```

Never modify production schema manually without recording the change in the migration strategy.

---

# 52. Seed Data

Development seed data should provide realistic but non-sensitive examples:

- Companies
- Branches
- Departments
- Roles
- Permissions
- Users
- Chart of accounts
- Products
- Suppliers
- Customers
- Employees

Seed data must never contain real credentials or secrets.

---

# 53. CI/CD Architecture

Pipeline:

```text
Commit
 ↓
Install
 ↓
Lint
 ↓
Typecheck
 ↓
Unit Tests
 ↓
Integration Tests
 ↓
API Tests
 ↓
E2E Tests
 ↓
Build
 ↓
Migration Validation
 ↓
Security Checks
 ↓
Artifact
 ↓
Deploy
```

Production deployment should require successful quality gates.

---

# 54. Deployment Environments

Minimum:

```text
development
staging
production
```

Each environment should have separate:

- Database
- Redis
- Object storage
- Secrets
- External integration credentials

Production data must never be casually copied into development.

---

# 55. Backup and Recovery

PostgreSQL requires:

- Automated backups
- Retention policy
- Restore testing
- Recovery documentation

Backups are not considered complete until restoration has been tested.

Document:

```text
RPO
RTO
Backup frequency
Retention
Restore procedure
Disaster recovery owner
```

---

# 56. Health and Readiness

Health endpoint should verify application liveness.

Readiness should verify dependencies required for serving traffic, such as:

```text
PostgreSQL
Redis
Queue infrastructure
Object storage where required
```

A service should not report ready when critical dependencies are unavailable.

---

# 57. Security Architecture Rules

Non-negotiable:

1. No secrets in source control.
2. No frontend-only authorization.
3. No unrestricted document URLs.
4. No cross-company data leakage.
5. No cross-branch data leakage.
6. No direct client access to database.
7. No silent modification of posted financial records.
8. No unauthorized export.
9. No sensitive information in logs.
10. No fake production integrations presented as real.

---

# 58. Vertical Slice Implementation Architecture

Every feature is implemented end-to-end:

```text
1. Database
      ↓
2. Domain model
      ↓
3. Application service
      ↓
4. API
      ↓
5. Authorization
      ↓
6. Workflow
      ↓
7. Accounting / events
      ↓
8. Frontend
      ↓
9. Tests
      ↓
10. Documentation
```

After each major slice:

```text
Typecheck
→ Lint
→ Unit tests
→ Integration tests
→ E2E tests where applicable
→ Migration verification
→ Production build
```

Do not proceed while the slice is unstable.

---

# 59. Initial Bootstrap Architecture

When starting from an empty repository:

```text
1. Create monorepo
2. Create Next.js frontend
3. Create NestJS API
4. Configure PostgreSQL
5. Configure Redis
6. Configure Docker Compose
7. Configure Prisma
8. Create initial migrations
9. Implement company/branch/department
10. Implement authentication
11. Implement users
12. Implement roles/permissions
13. Implement audit logging
14. Create dashboard shell
15. Add tests
16. Add CI checks
```

This sequence follows the project specification's initial implementation direction.

---

# 60. Initial Runtime Topology

Development:

```text
┌───────────────────────────────┐
│           Browser             │
└───────────────┬───────────────┘
                │
             HTTP/WS
                │
        ┌───────▼────────┐
        │     Next.js    │
        └───────┬────────┘
                │
             REST/WS
                │
        ┌───────▼────────┐
        │     NestJS     │
        └───┬────────┬───┘
            │        │
       ┌────▼───┐ ┌──▼─────┐
       │Postgres│ │ Redis  │
       └────────┘ └───┬────┘
                      │
                  ┌───▼────┐
                  │ Worker │
                  └───┬────┘
                      │
               ┌──────▼──────┐
               │ Object Store│
               └─────────────┘
```

---

# 61. Scaling Strategy

The initial deployment is a modular monolith.

When scale requires it, individual workloads can be separated without rewriting the domain model.

Potential extraction candidates:

- Notification worker
- Reporting/export worker
- Document processing worker
- Integration worker
- Search service
- Communication service

Do not extract a module into a microservice merely because it exists as a domain module.

---

# 62. Architecture Decision Record Process

Important architecture changes should have ADRs.

Example:

```text
docs/adr/
├── 0001-modular-monolith.md
├── 0002-postgresql.md
├── 0003-prisma.md
├── 0004-workflow-engine.md
├── 0005-accounting-posting.md
└── 0006-object-storage.md
```

Each ADR should contain:

```text
Context
Decision
Alternatives
Consequences
Status
```

This is a recommended project-governance enhancement for maintaining architectural clarity as the ERP grows.

---

# 63. Dependency Rules for AI-Assisted Development

Claude Code / coding agents must:

1. Read `CLAUDE.md`.
2. Read relevant `docs/` documents.
3. Inspect the existing repository before modifying it.
4. Preserve working functionality.
5. Follow module boundaries.
6. Never invent missing requirements silently.
7. Never bypass authorization.
8. Never fake production integrations.
9. Update documentation when architecture changes.
10. Run relevant tests after changes.
11. Keep the application runnable after every major milestone.

---

# 64. Architecture Definition of Done

Architecture implementation is acceptable when:

- Monorepo is operational.
- Frontend runs.
- API runs.
- Worker runs.
- PostgreSQL is connected.
- Redis is connected.
- Prisma migrations work.
- Module boundaries are established.
- Authentication is implemented.
- Authorization architecture exists.
- Company/branch scope exists.
- Audit infrastructure exists.
- Error handling exists.
- Logging exists.
- Health/readiness endpoints exist.
- CI checks exist.
- Docker development environment works.
- Documentation reflects actual implementation.

---

# 65. Architecture Invariants

The following are architectural invariants:

```text
Frontend is never the security boundary.

Operational modules never silently mutate posted accounting history.

Financial posting is transactional.

Cross-module dependencies are explicit.

External providers are accessed through adapters.

Sensitive actions are auditable.

Company/branch scope is enforced server-side.

Background work is retryable and observable.

Production secrets are never committed.

The database is the authoritative transactional source.

Reports use authoritative backend data.

The application remains modular even though it is initially one deployable monolith.
```

---

# 66. Relationship to Other Project Documents

```text
PRD.md
  │
  ├── Defines WHAT and WHY
  │
  ▼
ARCHITECTURE.md
  │
  ├── Defines HOW the system is structured
  │
  ▼
DATA-MODEL.md
  │
  ├── Defines HOW data is represented
  │
  ▼
USER-FLOWS.md
  │
  ├── Defines HOW users and business processes move through the system
  │
  ▼
UI-UX.md
  │
  ├── Defines HOW users interact with the application
  │
  ▼
CLAUDE.md
  │
  └── Defines HOW the AI coding agent must implement and maintain all of the above
```

---

# 67. Next Architecture Document

The next document is:

**`DATA-MODEL.md`**

It must define the ERP's database/domain model at professional implementation depth, including:

- Organization hierarchy
- Identity
- Roles
- Permissions
- Employees
- Attendance
- Leave
- Payroll
- Suppliers
- Procurement
- Products
- Warehouses
- Stock movements
- Customers
- Sales
- Fixed assets
- Chart of accounts
- Journals
- Journal lines
- AR
- AP
- Cash
- Bank
- Taxes
- Financial periods
- Documents
- Attachments
- Notifications
- Workflows
- Audit events
- Reporting metadata
- Relationships
- Constraints
- Indexing strategy
- Tenant/scope rules
- Historical/immutable records
- Accounting relationships
- Migration strategy
