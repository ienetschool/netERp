# USER-FLOWS.md

## Enterprise Office ERP — User Workflow Specification

**Version:** 1.0  
**Purpose:** Build-source workflow contract for the ERP implementation.

> This document defines the expected business journeys, lifecycle states, approvals, exceptions, accounting/inventory effects, notifications, audit events, permissions, and acceptance flows. Implementation should follow the supplied project specification rather than inventing business rules.

---

## 1. Workflow Principles

The ERP is workflow-driven rather than page-driven.

A normal transaction follows:

```text
Create
  ↓
Validate
  ↓
Save Draft
  ↓
Submit
  ↓
Review / Approval
  ↓
Approve / Reject / Return
  ↓
Controlled Processing
  ↓
Post where applicable
  ↓
Audit + Events + Notifications
  ↓
Downstream Process
```

The supplied specification defines common actions including Draft, Submit, Review, Approve, Reject, Return for correction, Cancel, Post and Reverse where applicable.

Financial impact must occur through controlled posting. Posted financial records must preserve history; corrections use controlled reversal/adjustment mechanisms rather than silently changing historical entries.

---

## 2. Universal Workflow Model

### 2.1 Common states

Where applicable:

```text
DRAFT
SUBMITTED
UNDER_REVIEW
APPROVED
CHANGES_REQUESTED
REJECTED
CANCELLED
READY_TO_PROCESS
PROCESSED
POSTED
REVERSED
```

Not every entity requires every state. Domain-specific state machines below take precedence.

### 2.2 Transition rules

Every transition must define:

```text
actor
permission
current state
target state
validation rules
required fields
approval requirements
side effects
notifications
audit event
domain event
```

Invalid transitions must be rejected server-side.

---

## 3. Approval Engine

The workflow engine must support:

```text
sequential approval
parallel approval
amount-based approval
role-based approval
company/branch routing
department routing
cost-center routing
delegation
escalation
approval history
comments
SLA/due dates
notifications
```

### 3.1 Approval task

Each approval task should retain:

```text
workflow_instance_id
workflow_step
approver
status
created_at
due_at
acted_at
decision
comments
rejection_reason
delegated_from
```

### 3.2 Approval outcomes

```text
APPROVE
REJECT
REQUEST_CHANGES
DELEGATE where authorized
```

Approval decisions are auditable.

### 3.3 Central approval inbox

The approval inbox should show:

```text
document type
document number
requester
company
branch
department
amount
submitted date
due date
current approval step
status
```

Actions must respect permissions and organizational scope.

---

# 4. Authentication and Access

## 4.1 Login

```text
Enter credentials
→ Validate account
→ Check account status
→ Authenticate
→ MFA if configured
→ Create session
→ Resolve roles
→ Resolve organization scopes
→ Load authorized navigation
→ Dashboard
```

Failure paths:

```text
Invalid credentials
Locked account
Disabled account
MFA failure
Rate limit
```

Sensitive authentication details must not be exposed.

## 4.2 Logout

```text
Logout
→ invalidate session
→ audit security event
→ return to login
```

## 4.3 User creation

```text
Administrator
→ Create User
→ Validate identity
→ Link employee when applicable
→ Assign roles
→ Assign company/branch/department/warehouse scope
→ Save
→ Audit
→ Send invitation when configured
```

## 4.4 Role/permission changes

```text
Authorized administrator
→ Edit role/permission
→ Validate
→ Confirm
→ Save
→ Invalidate affected authorization cache
→ Audit
```

Authorization is always enforced server-side.

---

# 5. Organization Administration

## 5.1 Company

```text
Create Company
→ Enter legal/configuration information
→ Select base currency
→ Configure fiscal year
→ Save
→ Initialize required configuration
→ Audit
```

## 5.2 Branch

```text
Create Branch
→ Assign Company
→ Configure address/timezone
→ Configure departments/warehouse as needed
→ Activate
```

## 5.3 Scope switching

```text
Select company/branch context
→ Server validates access
→ Set active context
→ Reload authorized data
```

The frontend selection never grants access by itself.

---

# 6. HR Employee Lifecycle

## 6.1 Onboarding

```text
Create Employee
→ Draft
→ Validate personal/employment information
→ Assign company/branch/department
→ Assign job/title/manager
→ Assign pay group
→ Add documents
→ Create user optionally
→ Approve where configured
→ Activate
```

Activation may initialize:

```text
leave eligibility
payroll eligibility
attendance configuration
```

## 6.2 Transfer

```text
Active Employee
→ Transfer Request
→ Select destination
→ Approval where configured
→ Effective Date
→ Close previous assignment
→ Create effective-dated assignment
→ Audit
→ Notify
```

Historical assignments remain available.

## 6.3 Suspension

```text
Active
→ Suspension Request
→ Reason
→ Effective Date
→ Approval where configured
→ SUSPENDED
→ Restrict relevant access
→ Audit
```

## 6.4 Termination

```text
Active
→ Termination Request
→ Validate outstanding HR/payroll requirements
→ Approval
→ Effective termination date
→ Final payroll process
→ Disable access
→ Close active assignments
→ TERMINATED
→ Audit
```

---

# 7. Attendance

## 7.1 Clock-in

```text
Employee
→ Clock In
→ Validate active employment
→ Resolve applicable shift
→ Record attendance event
→ Calculate applicable lateness
→ Audit
```

## 7.2 Clock-out

```text
Clocked In
→ Clock Out
→ Calculate worked time
→ Calculate overtime according to configured rules
→ Update attendance
→ Audit
```

## 7.3 Attendance correction

```text
Employee/authorized HR
→ Correction Request
→ Enter corrected information + reason
→ Submit
→ Approval
→ Update business attendance
→ Preserve original event
→ Audit
```

---

# 8. Leave Management

## 8.1 Leave request

```text
Employee
→ New Leave Request
→ Select leave type
→ Select dates
→ Validate balance
→ Validate conflicts
→ Enter reason
→ Attach supporting document when required
→ Submit
```

Lifecycle:

```text
DRAFT
→ SUBMITTED
→ PENDING_APPROVAL
→ APPROVED
```

Alternative outcomes:

```text
PENDING_APPROVAL
→ REJECTED

PENDING_APPROVAL
→ CHANGES_REQUESTED
→ DRAFT
```

On approval:

```text
Update leave balance
→ Update attendance/calendar
→ Apply configured payroll effect
→ Notify
→ Audit
```

## 8.2 Leave cancellation

```text
APPROVED
→ Cancellation Request
→ Validate cancellation rules
→ Approval where required
→ CANCELLED
→ Restore balance where applicable
→ Notify
→ Audit
```

---

# 9. Payroll

## 9.1 Payroll preparation

```text
Select company/pay group
→ Select payroll period
→ Validate employees
→ Load salary assignments
→ Load attendance
→ Load overtime
→ Load leave effects
→ Load deductions
→ Calculate
```

## 9.2 Payroll calculation

Conceptually:

```text
Base Salary
+ Earnings
+ Overtime
+ Approved Additions
- Deductions
- Applicable Taxes
= Net Pay
```

Employer costs remain separately identifiable.

## 9.3 Payroll approval

```text
CALCULATED
→ Review summary
→ Review exceptions
→ Submit
→ Approval
→ APPROVED
```

## 9.4 Payroll posting

```text
APPROVED
→ Validate open financial period
→ Generate balanced journal
→ Create salary expense
→ Create payroll liabilities
→ Create employer-cost accounting
→ POST
→ Audit
```

Payroll accounting must reconcile to payroll totals.

## 9.5 Payroll payment

```text
POSTED
→ Prepare payment
→ Bank/cash process
→ Confirm payment
→ PAID
→ Update bank/cash accounting
→ Audit
```

---

# 10. Procurement — Procure to Pay

## 10.1 Purchase Request

```text
Requester
→ New Purchase Request
→ Add lines
→ Validate required information
→ Save Draft
→ Submit
```

Approval:

```text
SUBMITTED
→ Apply approval rules
→ Sequential/parallel approval as configured
→ APPROVED
```

Alternative outcomes:

```text
REJECTED
CHANGES_REQUESTED
CANCELLED
```

## 10.2 RFQ

```text
Approved Purchase Request
→ Create RFQ
→ Select suppliers
→ Set response deadline
→ Send
→ Receive quotations
→ Close RFQ
```

## 10.3 Supplier quotation

```text
RFQ
→ Capture supplier quotation
→ Capture prices/terms/taxes
→ Validate
→ Compare
→ Select quotation
```

Comparison history must be preserved.

## 10.4 Purchase Order

```text
Selected quotation / approved request
→ Create PO
→ Validate supplier
→ Validate prices
→ Validate taxes
→ Validate delivery/payment terms
→ Submit
→ Approval
→ APPROVED
```

## 10.5 Purchase Order revision

```text
Approved PO
→ Change Request
→ Identify changed fields/lines
→ Approval where material
→ Create new revision
→ Preserve previous revision
```

Approved commercial history must not be silently overwritten.

## 10.6 Goods Receipt

```text
Approved PO
→ Receive Goods
→ Select warehouse/location
→ Enter received quantities
→ Capture batch/serial where required
→ Validate
→ Post Receipt
```

Effects:

```text
Stock movement
Inventory quantity update
Inventory valuation update
PO received quantity update
Audit
Domain event
```

## 10.7 Supplier Invoice / Three-Way Match

```text
Supplier Invoice
→ Match PO
→ Match Goods Receipt
→ Calculate/validate tax
→ Check variance
```

Three-way match:

```text
Purchase Order
+
Goods Receipt
+
Supplier Invoice
```

Result:

```text
MATCHED
→ eligible for approval/posting

VARIANCE
→ exception workflow
```

## 10.8 Supplier Invoice Posting

```text
Matched/Approved
→ Validate open period
→ Create AP
→ Create expense/inventory effect
→ Create tax effect
→ Create balanced GL journal
→ Link source document
→ POST
→ Audit
```

## 10.9 Supplier Payment

```text
Open AP
→ Create Payment
→ Select invoices
→ Allocate amounts
→ Validate bank/cash
→ Approval where configured
→ POST
→ Reduce AP
→ Reduce bank/cash
→ Create GL effect
→ Audit
```

Partial payment:

```text
OPEN
→ PARTIALLY_PAID
→ PAID
```

---

# 11. Inventory

## 11.1 Receipt

```text
Goods Receipt
→ Validate warehouse/location
→ Validate item
→ Validate quantity
→ Capture batch/serial
→ Create stock movement
→ Update stock balance
→ Update valuation
→ Audit
```

## 11.2 Issue

```text
Issue Request
→ Validate available quantity
→ Reserve where configured
→ Approval where configured
→ Post issue
→ Create stock movement
→ Reduce stock
→ Apply COGS/accounting effect where applicable
→ Audit
```

Negative stock should be rejected unless an explicit configuration permits it.

## 11.3 Transfer

```text
Transfer Request
→ Select source
→ Select destination
→ Select items
→ Approval where configured
→ Ship
→ Receive
```

A transfer must retain traceable outbound and inbound movements.

## 11.4 Adjustment

```text
Adjustment
→ Enter reason
→ Enter/count quantity
→ Calculate variance
→ Approval
→ Post
→ Stock movement
→ Valuation adjustment
→ GL adjustment where required
→ Audit
```

## 11.5 Batch/serial tracking

```text
Receipt → Assign batch/serial
Issue → Select batch/serial
Transfer → Preserve batch/serial
Return → Preserve traceability
```

---

# 12. Sales — Quote to Cash

## 12.1 Sales quotation

```text
New Quote
→ Select customer
→ Add lines
→ Pricing
→ Discount
→ Tax
→ Save
→ Submit
```

Approval may be required for configured pricing/discount conditions.

## 12.2 Sales order

```text
Accepted Quote / Order
→ Create Sales Order
→ Validate customer
→ Validate credit/configuration
→ Reserve inventory where configured
→ Submit
→ Approval
→ APPROVED
```

## 12.3 Delivery

```text
Approved Sales Order
→ Create Delivery
→ Select warehouse
→ Select quantities
→ Pick/pack where configured
→ Deliver
→ POST
```

Effects:

```text
Inventory issue
Fulfillment update
COGS effect where applicable
Audit
```

## 12.4 Customer Invoice

```text
Delivery / approved billing source
→ Create Invoice
→ Validate customer
→ Validate quantity/price/tax
→ Approval where configured
→ POST
```

Effects:

```text
AR
Revenue
Tax
COGS/inventory effect where applicable
GL
Audit
```

## 12.5 Customer Receipt

```text
Open AR
→ Create Receipt
→ Select customer
→ Enter amount
→ Select invoices
→ Allocate
→ Approval where configured
→ POST
→ Reduce AR
→ Increase bank/cash
→ GL
→ Audit
```

---

# 13. Accounting

## 13.1 Manual journal

```text
Accountant
→ New Journal
→ Select date/period
→ Enter lines
→ Validate accounts
→ Validate dimensions
→ Validate debit = credit
→ Submit
→ Approval where required
→ POST
```

## 13.2 Posting gate

Before posting:

```text
Source exists
Source state permits posting
Financial period is OPEN
User has posting permission
Debits = Credits
Accounts are valid
Dimensions are valid
Currency/rate is valid
Tax is valid where applicable
Organization scope is valid
Duplicate posting is prevented
```

Any failed validation prevents the financial transaction from partially posting.

## 13.3 Reversal

```text
Posted Journal
→ Reversal Request
→ Enter reason
→ Approval where required
→ Create linked reversal journal
→ POST reversal
→ Mark relationship to original
→ Audit
```

Original posted history remains intact.

## 13.4 Financial period close

```text
OPEN
→ Run close checks
→ Validate unresolved exceptions
→ Validate reconciliation status
→ Validate required workflows
→ CLOSING
→ CLOSED
```

Normal postings to CLOSED periods must fail.

---

# 14. Accounts Receivable

## 14.1 Invoice lifecycle

```text
DRAFT
→ SUBMITTED
→ APPROVED
→ POSTED
→ OPEN
→ PARTIALLY_PAID
→ PAID
```

Controlled correction:

```text
POSTED
→ Credit Note / Reversal
```

## 14.2 Aging

Scheduled process:

```text
Daily job
→ Find overdue invoices
→ Calculate aging
→ Create alerts
→ Notify responsible users
```

## 14.3 Credit control

When configured:

```text
Sales Order
→ Calculate exposure
→ Compare credit limit
→ If over limit
→ Create credit exception
→ Approval
```

---

# 15. Accounts Payable

## 15.1 Invoice lifecycle

```text
DRAFT
→ MATCHING
→ APPROVAL
→ POSTED
→ OPEN
→ PARTIALLY_PAID
→ PAID
```

Exceptions include:

```text
matching variance
duplicate invoice
invalid tax
closed period
missing receipt
supplier mismatch
```

## 15.2 Payment proposal

```text
Open invoices
→ Filter by due date/priority
→ Generate payment proposal
→ Review
→ Approve
→ Create payments
```

---

# 16. Fixed Assets

## 16.1 Acquisition

```text
Eligible purchase/invoice
→ Capitalization decision
→ Create asset
→ Assign category
→ Assign useful life/method
→ POST acquisition
→ Fixed Asset + AP/Cash + GL
```

## 16.2 Depreciation

```text
Open period
→ Identify active depreciable assets
→ Calculate depreciation
→ Generate schedule
→ Validate
→ POST
→ Depreciation expense
→ Accumulated depreciation
→ GL
```

Depreciation processing must be idempotent.

## 16.3 Transfer

```text
Asset
→ Transfer Request
→ Select destination
→ Approval
→ Effective date
→ Update assignment
→ Preserve history
→ Audit
```

## 16.4 Disposal

```text
Active Asset
→ Disposal Request
→ Reason
→ Calculate book value
→ Calculate gain/loss
→ Approval
→ POST
→ Remove from active register
→ GL
→ Audit
```

---

# 17. Document Management

## 17.1 Upload

```text
Upload
→ Validate type/size
→ Security scanning where configured
→ Store object
→ Calculate content hash
→ Create metadata
→ Link to entity
→ Audit
```

## 17.2 Versioning

```text
Existing Document
→ Upload New Version
→ Create immutable version
→ Update current version pointer
→ Preserve prior version
→ Audit
```

## 17.3 Access

```text
Open Document
→ Resolve entity authorization
→ Resolve document permission
→ Secure access
→ Audit access
```

Document access must not rely only on an obscure URL.

---

# 18. Office Management

## 18.1 Visitor

```text
Register visitor
→ Identify host
→ Record purpose
→ Check In
→ Notify host
→ Check Out
→ Complete visit record
```

## 18.2 Correspondence

```text
Receive/send
→ Register
→ Assign number
→ Attach document
→ Assign responsible employee
→ Track
→ Close
```

## 18.3 File room

```text
Register file
→ Classify
→ Assign location
→ Issue
→ Return
→ Audit movement
```

---

# 19. Communication and Notifications

## 19.1 Chat

```text
Create conversation
→ Add participants
→ Send message
→ Persist
→ Create notification
→ Update unread count
```

## 19.2 External notification

```text
Domain Event
→ Notification Service
→ Channel Adapter
→ Provider
→ Delivery Status
→ Retry recoverable failure
```

Channels may include:

```text
In-app
Email
SMS
WhatsApp adapter
Push-ready architecture
```

## 19.3 Notification center

Categories:

```text
Approvals
HR
Finance
Inventory
Procurement
Sales
System
Mentions
```

Views:

```text
Unread
All
By category
```

Each notification should link to the relevant entity when the user has access.

---

# 20. Background Jobs

Use asynchronous processing for:

```text
email
SMS
WhatsApp
large reports
PDF generation
large exports
notifications
scheduled reports
document processing
reminders
```

Jobs should record:

```text
job_id
attempt
status
started_at
completed_at
error
```

Retry only recoverable failures.

Scheduled jobs must be idempotent.

Typical schedules:

```text
approval reminders
invoice due reminders
document expiry reminders
leave accrual
payroll processing tasks
depreciation
scheduled reports
temporary-file cleanup
overdue alerts
```

---

# 21. Reporting and Export

## 21.1 Report

```text
Select Report
→ Apply filters
→ Validate authorization
→ Query authorized data
→ Render result
```

## 21.2 Export

```text
Export request
→ Permission check
→ Generate synchronously or asynchronously
→ Secure temporary storage
→ Notify completion
→ Secure download
→ Audit export
```

## 21.3 Scheduled report

```text
Report definition
→ Schedule
→ Job queue
→ Generate
→ Deliver
→ Record delivery status
```

---

# 22. Global Search

```text
Enter query
→ Resolve user's organization scope
→ Search authorized entities
→ Filter unauthorized results
→ Group results
→ Open selected authorized record
```

Search must never reveal records outside the user's permissions.

---

# 23. Error and Transaction Handling

API errors should use a consistent structure such as:

```json
{
  "success": false,
  "code": "VALIDATION_ERROR",
  "message": "Human readable message",
  "details": {}
}
```

Production responses must not expose stack traces.

For financial and inventory transactions:

```text
Validate
→ Begin transaction
→ Apply required domain changes
→ Create audit/outbox records
→ Commit
```

Failure:

```text
ROLLBACK ALL
```

The system must not leave half-posted accounting or inventory state.

---

# 24. Domain Event Flows

## Purchase invoice

```text
SupplierInvoicePosted
→ AP updated
→ GL posted
→ Tax updated
→ Notification
→ Audit
→ Search/reporting update
```

## Customer invoice

```text
CustomerInvoicePosted
→ AR updated
→ Revenue/tax GL
→ Notification
→ Customer balance update
→ Audit
```

## Employee termination

```text
EmployeeTerminated
→ Restrict access
→ Final payroll task
→ HR notification
→ Audit
```

Events should be delivered reliably through the application's event/outbox mechanism.

---

# 25. Audit Requirements

Sensitive operations must produce auditable history, including:

```text
authentication/security events
user creation
role/permission changes
scope changes
employee changes
attendance corrections
leave approvals/rejections
payroll calculation/approval/posting
purchase approvals
PO approvals
goods receipt posting
inventory adjustments
supplier invoice posting
supplier payments
sales approvals
deliveries
customer invoice posting
customer receipts
journal posting
journal reversal
period close
asset acquisition
asset transfer/disposal
document upload/version/access
exports
configuration changes
integration operations
```

Audit information should include:

```text
actor
timestamp
action
resource
resource_id
before
after
request/correlation ID
metadata
```

---

# 26. Permission Model

Workflow actions should map to explicit permissions:

```text
resource.create
resource.read
resource.update
resource.submit
resource.approve
resource.reject
resource.cancel
resource.post
resource.reverse
resource.export
```

Examples:

```text
purchase_request.submit
purchase_request.approve
purchase_order.approve
goods_receipt.post
supplier_invoice.post
supplier_payment.post

sales_order.approve
delivery.post
customer_invoice.post
customer_receipt.post

payroll.calculate
payroll.approve
payroll.post

journal.create
journal.post
journal.reverse
period.close

inventory.adjust
inventory.transfer
```

Permissions must always be evaluated with organization scope.

---

# 27. Approval Routing Patterns

The exact thresholds are configuration, not hard-coded behavior.

## Lower-value procurement

```text
Requester
→ Department approval
→ Procurement
```

## Higher-value procurement

```text
Requester
→ Department Manager
→ Procurement Manager
→ Finance Manager
→ Configured final authority
```

## Payroll

```text
Payroll preparation
→ Finance review
→ Authorized approval
→ Accounting post
```

## Journal

```text
Accountant
→ Configured accounting approver
→ POST
```

---

# 28. Business Invariants

The implementation must enforce these principles:

```text
1. Posted journals always balance.
2. Draft transactions normally have no GL impact.
3. Closed periods reject normal postings.
4. Posted financial records are not silently editable.
5. Reversals reference original transactions.
6. Inventory reconciles to stock movements.
7. Inventory valuation is reproducible.
8. Payroll accounting reconciles to payroll totals.
9. AR reconciles to customer transactions.
10. AP reconciles to supplier transactions.
11. Operational postings have traceable source data.
12. Cross-company data cannot be linked without explicit support.
13. Authorization is server-side.
14. Approval decisions are auditable.
15. Scheduled jobs are idempotent.
16. Slow external work is asynchronous.
17. Sensitive exports are audited.
18. Document access is authorization-controlled.
19. Transfers have traceable paired movements.
20. Financial corrections preserve historical records.
```

---

# 29. End-to-End Acceptance Journeys

## 29.1 Procure to Pay

```text
Login
→ Select company/branch
→ Purchase Request
→ Submit
→ Approval
→ RFQ
→ Supplier Quotation
→ Selection
→ Purchase Order
→ PO Approval
→ Goods Receipt
→ Inventory Update
→ Supplier Invoice
→ Three-Way Match
→ Invoice Approval
→ POST
→ AP + Tax + Inventory/Expense + GL
→ Supplier Payment
→ AP Reduction
→ Bank/Cash + GL
→ Complete Audit Trail
```

## 29.2 Quote to Cash

```text
Customer
→ Quotation
→ Acceptance
→ Sales Order
→ Approval
→ Delivery
→ Inventory Issue
→ Customer Invoice
→ POST
→ AR + Revenue + Tax + GL
→ Receipt
→ AR Reduction
→ Bank/Cash + GL
```

## 29.3 Payroll to GL

```text
Employee
→ Attendance
→ Leave
→ Payroll Calculation
→ Review
→ Approval
→ POST
→ Salary Expense + Liabilities + Employer Cost + GL
→ Payment
→ Bank/Cash
→ Reconciliation
```

## 29.4 Inventory Adjustment

```text
Inventory Manager
→ Adjustment
→ Count/Quantity
→ Variance
→ Approval
→ POST
→ Stock Movement
→ Valuation Adjustment
→ GL where required
→ Audit
```

## 29.5 Asset Lifecycle

```text
Purchase
→ Capitalization
→ Asset Register
→ Depreciation
→ Transfer
→ Continued Depreciation
→ Disposal
→ Gain/Loss
→ GL
```

## 29.6 Leave

```text
Employee
→ Leave Request
→ Balance Validation
→ Manager Approval
→ Calendar
→ Attendance
→ Payroll Effect
→ Notification
→ Audit
```

---

# 30. Testing Requirements

Every workflow requires tests for:

```text
happy path
validation failure
authorization failure
organization-scope failure
approval rejection
return-for-changes
cancellation
duplicate submission
concurrent action
closed-period failure
posting failure
retry
notification failure
audit verification
```

Minimum coverage must include applicable:

```text
authentication/RBAC
HR
attendance
leave
payroll
procurement
inventory
sales
accounting posting
workflow
permissions
```

---

# 31. Vertical Slice Rule

A feature is not complete when its UI exists.

Implementation sequence:

```text
Database
↓
Domain Model
↓
Service
↓
API
↓
Validation
↓
Authorization
↓
Workflow
↓
Accounting / Inventory / Events
↓
Frontend
↓
Tests
↓
Documentation
```

After each slice:

```text
Typecheck
→ Lint
→ Unit Tests
→ Integration Tests
→ E2E where applicable
→ Migration verification
→ Production build
```

Do not move to the next unstable slice.

---

# 32. Module Definition of Done

A module is complete only when applicable:

```text
database schema
versioned migrations
backend service
API endpoints
validation
permissions
organization scope
workflow
audit
notifications
accounting integration
frontend pages
loading states
empty states
error states
working forms
working tables
filters
detail pages
document links
tests
documentation
```

A screen existing in the UI does not mean the module is complete.

---

# 33. Initial System Acceptance

The first implementation milestone must verify:

```text
application starts locally
PostgreSQL connected
Redis connected
migrations successful
authentication works
user creation works
roles/permissions work
organization scope works server-side
audit records are generated
file storage abstraction works
navigation works
dashboard shell works
safe seed data loads
automated tests run
typecheck passes
lint passes
production build succeeds
no secrets are committed
documentation matches implementation
```

---

# 34. Claude Code Implementation Rules

Claude Code should treat this file as a workflow contract.

For every workflow:

1. Identify the entity state machine.
2. Identify actors.
3. Resolve permission.
4. Resolve company/branch/department/warehouse scope.
5. Validate business rules.
6. Create/update workflow state.
7. Create approval tasks where required.
8. Generate notifications.
9. Record audit event.
10. Apply accounting/inventory effect only at the defined controlled action.
11. Emit domain/outbox event.
12. Add automated tests.
13. Document API/UI behavior.

Do not silently invent missing financial rules.

Do not bypass authorization.

Do not create accounting entries without a defined source/effect.

Do not mutate posted historical transactions to erase history.

When a required rule is not defined in the supplied specification, isolate it behind a configurable/domain-level implementation point and document the gap rather than guessing.

---

# 35. Source Alignment

This workflow document is intended to remain aligned with the supplied ERP requirements for:

- configurable workflows
- Draft / Submit / Review / Approve / Reject / Return / Cancel / Post / Reverse
- approval thresholds
- role-based routing
- company/branch/department/cost-center scope
- sequential/parallel approval
- delegation
- escalation
- approval history
- notifications
- SLA tracking
- auditable decisions
- accounting as the financial backbone
- controlled posting
- immutable posted history
- auditability
- multi-company / multi-branch authorization
- document linkage
- centralized notifications
- background jobs
- idempotent scheduled tasks
- end-to-end business processes
- vertical-slice implementation
- module definition of done

Where the source does not define a specific threshold, formula, or business policy, this document intentionally leaves it configurable rather than inventing a value.

---

# 36. Next Build Document

**UI-UX.md**

The next document translates these workflows into the application experience:

```text
navigation
layout
dashboard
tables
filters
forms
detail pages
approval inbox
workflow timelines
document panels
accounting screens
inventory screens
HR screens
responsive behavior
loading/empty/error states
accessibility
keyboard behavior
design system
```

The UI specification should be derived from these workflows so screens are not designed as disconnected prototypes.
