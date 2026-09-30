# UI-UX.md

## Enterprise Office ERP — Design System, Navigation & Interaction Specification

**Version:** 1.0  
**Status:** Build Source  
**Companions:** PRD.md, ARCHITECTURE.md, DATA-MODEL.md, USER-FLOWS.md

> This document converts the product, architecture and workflow requirements into a single professional ERP user experience. The UI must feel like one integrated ERP rather than separate applications.

---

# 1. UX Goals

The application must provide:

- responsive design
- accessible components
- consistent navigation
- clear page hierarchy
- professional data tables
- powerful filters
- saved views
- safe bulk actions
- keyboard-friendly workflows
- loading states
- empty states
- error states
- confirmation for destructive actions
- status indicators
- activity timelines
- document history
- linked-record navigation
- mobile-friendly critical workflows

These requirements are explicitly defined in the supplied PRD. fileciteturn9file1L140-L163

The UI is a productivity application, not a marketing website. Prioritize information density, clarity, speed, discoverability, auditability and predictable interaction.

---

# 2. Technology Contract

The frontend stack is:

```text
Next.js
React
TypeScript
Tailwind CSS
Accessible component system such as shadcn/ui
TanStack Query
React Hook Form
Zod
Recharts or equivalent
WebSocket client
```

The architecture also specifies feature-based frontend organization and keeps business-rule enforcement on the server. fileciteturn9file7L1303-L1342

Server state should use TanStack Query with query keys, cache policies, mutation invalidation, pagination, prefetching where useful and error handling. fileciteturn9file7L1346-L1359

Forms should use React Hook Form + Zod, while server validation remains authoritative. Forms must handle draft preservation where appropriate, validation errors, server errors, unsaved changes, loading/submission states and accessible labels/errors. fileciteturn9file7L1363-L1385

---

# 3. Product Shell

## 3.1 Global layout

Desktop:

```text
┌───────────────────────────────────────────────────────────────┐
│ Top Bar                                                       │
│ Logo | Global Search | Context | Notifications | User        │
├───────────────┬───────────────────────────────────────────────┤
│               │                                               │
│ Sidebar       │ Main Content                                  │
│ Navigation    │                                               │
│               │                                               │
│               │                                               │
└───────────────┴───────────────────────────────────────────────┘
```

The shell consists of:

```text
Application Header
Primary Navigation
Breadcrumbs
Page Header
Main Content
Contextual Actions
Global Notification Layer
```

## 3.2 Desktop sidebar

The sidebar supports:

```text
Dashboard
My Work
Approvals
HR
Payroll
Procurement
Inventory
Sales
Accounting
Assets
Office
Communication
Reports
Documents
Administration
Settings
```

Only modules/actions authorized for the user should appear as actionable navigation.

Permission-aware visibility is a UX feature, but server-side authorization remains authoritative.

## 3.3 Collapsed sidebar

Collapsed navigation shows:

```text
icons
tooltips
active-state indicator
```

The user can expand it without losing page context.

## 3.4 Mobile navigation

Mobile uses:

```text
Top Bar
Bottom/Drawer Navigation
Page Content
Sticky primary action where appropriate
```

Critical workflows must remain usable on mobile, as required by the PRD.

---

# 4. Top Bar

The global header contains:

```text
Application identity
Global search
Company/branch context selector
Quick-create action
Notifications
Help
User menu
```

## 4.1 Context selector

Display:

```text
Company
Branch
```

Optionally:

```text
Department
Warehouse
```

Changing context:

```text
Validate access
→ update active context
→ invalidate affected queries
→ reload scoped data
```

Never treat client-side context as an authorization boundary.

## 4.2 User menu

Items:

```text
My Profile
Preferences
Security
Active Sessions
Help
Sign Out
```

---

# 5. Global Search

Search should support:

```text
People
Customers
Suppliers
Products
Documents
Purchase documents
Sales documents
Financial documents
Employees
Transactions
```

The PRD explicitly requires authorization-aware global search; users must never receive search results for records they cannot view. fileciteturn9file2L393-L410

## 5.1 Search interaction

```text
Click search / keyboard shortcut
→ search dialog
→ enter query
→ grouped results
→ keyboard navigation
→ open authorized record
```

Groups:

```text
People
Customers
Suppliers
Products
Documents
Purchasing
Sales
Finance
HR
```

## 5.2 Search result

Each result may show:

```text
record type
display number/name
secondary metadata
status
context
```

Do not expose unauthorized fields merely because another field was searchable.

---

# 6. Dashboard

The dashboard is a role-aware operational home page.

## 6.1 Dashboard structure

```text
Page Header
  ↓
KPI Cards
  ↓
Operational Alerts
  ↓
My Work / Approvals
  ↓
Charts
  ↓
Recent Activity
  ↓
Quick Actions
```

## 6.2 KPI cards

Examples:

```text
Pending Approvals
Open Purchase Orders
Open Customer Receivables
Open Supplier Payables
Inventory Alerts
Payroll Status
Cash/Bank Summary
```

KPI visibility is role-aware.

## 6.3 Operational alerts

Examples:

```text
Overdue approvals
Low stock
Overdue invoices
Payroll exceptions
Failed jobs
Documents approaching expiry
```

Alerts link to the relevant workflow.

## 6.4 Charts

Charts should be used for trends and comparisons rather than decoration.

Examples:

```text
Revenue trend
Expense trend
AR aging
AP aging
Inventory movement
Payroll cost
Purchase volume
```

Financial charts must use authoritative posted accounting data where the metric represents financial reporting. The PRD requires financial reporting to use posted accounting data. fileciteturn9file1L84-L105

---

# 7. Page Hierarchy

Every major page follows:

```text
Breadcrumb
Page Title
Description / Context
Primary Actions
Secondary Actions
Content
```

Example:

```text
Procurement / Purchase Orders

Purchase Orders
Create and manage approved supplier orders.

[Create Purchase Order] [Export]

[Filters...]

[Table...]
```

Avoid cluttered toolbars.

---

# 8. List Pages

Every transactional/master-data list should support, where applicable:

```text
search
filters
date filters
status
company
branch
department
warehouse
owner/requester
sorting
pagination
saved views
column configuration
export
bulk actions
```

The PRD specifically requires professional tables, powerful filters, saved views and safe bulk actions. fileciteturn9file1L140-L161

## 8.1 Table design

Columns should be:

```text
high-value first
consistent
sortable when supported
responsive
permission-aware
```

Example Purchase Order:

```text
PO Number
Supplier
Date
Expected Delivery
Amount
Branch
Status
Approval
Actions
```

## 8.2 Table behavior

Use:

```text
sticky header for long tables
row hover
keyboard focus
clickable primary identifier
status badge
context menu
pagination
```

Do not make the entire row accidentally destructive/clickable.

## 8.3 Bulk actions

Allowed only when safe.

Examples:

```text
Export
Assign
Mark reviewed
Archive where supported
```

Do not expose bulk financial posting or irreversible actions without an explicit business requirement and confirmation flow.

---

# 9. Filters

Filters should appear in a reusable filter bar/drawer.

Common filters:

```text
Date range
Status
Company
Branch
Department
Warehouse
Cost center
Owner
Requester
Customer
Supplier
```

Filter UX:

```text
Filter button
→ filter panel
→ select criteria
→ Apply
→ active filter chips
→ Clear All
```

Saved filters:

```text
Save View
→ Name
→ Save
```

Users can:

```text
switch view
edit view
delete view
set default view where supported
```

---

# 10. Detail Pages

Every important entity has a consistent detail layout.

```text
Header
├── Identifier
├── Status
├── Primary actions
└── Secondary actions

Tabs / Sections
├── Overview
├── Lines / Details
├── Workflow
├── Documents
├── Activity
└── Related Records
```

## 10.1 Header actions

Actions depend on state.

Example:

```text
Draft:
Edit
Submit
Delete if permitted

Submitted:
View
Approve if authorized
Reject
Request Changes

Approved:
Process
Cancel if permitted

Posted:
View
Reverse where permitted
```

The UI must not display an action as executable when the server would reject it, but the server remains authoritative.

---

# 11. Status System

Use consistent semantic statuses.

Examples:

```text
Draft
Submitted
Pending Approval
Approved
Changes Requested
Rejected
Cancelled
Processing
Posted
Paid
Partially Paid
Closed
Overdue
Failed
```

Statuses should be communicated through:

```text
badge
label
icon where useful
text
```

Do not rely on color alone.

---

# 12. Forms

Forms should be structured around business tasks rather than database fields.

## 12.1 Form layout

Use sections:

```text
Basic Information
Organization
Dates
Lines
Financial Information
Attachments
Notes
```

## 12.2 Required fields

Clearly indicate required fields.

Validation should occur:

```text
on appropriate field interaction
on submit
server-side
```

Never expose raw backend validation internals.

## 12.3 Unsaved changes

When a user has modified a form:

```text
navigate away
→ warn about unsaved changes
```

Provide:

```text
Stay
Leave
Save Draft where applicable
```

## 12.4 Submission

Submit button states:

```text
Ready
Submitting...
Success
Error
```

Prevent duplicate submission.

---

# 13. Multi-Step Forms

For complex processes:

```text
Step 1 — Header
Step 2 — Lines
Step 3 — Financial/Tax
Step 4 — Attachments
Step 5 — Review
```

Navigation:

```text
Back
Continue
Save Draft
Submit
```

Do not require users to repeatedly re-enter data between workflow stages.

---

# 14. Line-Item Editors

Used for:

```text
Purchase Requests
Purchase Orders
Supplier Invoices
Sales Quotes
Sales Orders
Invoices
Journal Entries
Stock Transfers
```

Features:

```text
Add line
Remove line
Duplicate line
Inline quantity/price editing
Totals
Tax
Discount
Validation
Keyboard navigation
```

For accounting journals:

```text
Account
Description
Debit
Credit
Dimensions
```

Live validation:

```text
Total Debit
Total Credit
Difference
```

Posting should be blocked until the backend validates balance.

---

# 15. Approval Experience

## 15.1 Approval inbox

Layout:

```text
Approval Inbox

[Filters]

┌───────────────────────────────────────────┐
│ Document | Requester | Amount | Due | ... │
└───────────────────────────────────────────┘
```

Selecting an item opens the document with:

```text
Summary
Business reason
Financial information
Attachments
Workflow history
Audit/activity
Related records
```

## 15.2 Approval actions

Primary actions:

```text
Approve
Reject
Request Changes
```

Optional:

```text
Delegate
```

Destructive/rejection actions require reason where the workflow requires it.

## 15.3 Approval timeline

Display:

```text
Submitted
→ Step 1 approved
→ Step 2 pending
→ Step 3...
```

Include:

```text
actor
date/time
decision
comment
```

---

# 16. Workflow Timeline

Every major transactional record should expose a timeline where applicable.

Example:

```text
Created
↓
Submitted
↓
Approved
↓
PO Created
↓
Goods Received
↓
Invoice Posted
↓
Payment Made
```

Each event can show:

```text
event
actor
timestamp
comment
linked document
```

This provides operational traceability without forcing users to inspect audit tables.

---

# 17. Document Panel

Transactions should provide a consistent document area.

Features:

```text
Upload
Preview
Download
Version history
Metadata
Category
Retention information
Access-controlled sharing where supported
```

Document requirements include attachments, versioning, metadata, access control, categories, retention metadata, search, preview, download permissions, audit history and transaction linkage. fileciteturn9file2L345-L361

---

# 18. Related Records

Show relationships explicitly.

Example Purchase Order:

```text
Purchase Request
RFQ
Supplier Quotations
Goods Receipts
Supplier Invoices
Payments
Journal Entries
Documents
```

Example Sales Invoice:

```text
Quotation
Sales Order
Delivery
Customer
Receipts
Journal Entries
Documents
```

Use linked-record navigation rather than duplicate data.

---

# 19. Activity and Audit UX

The UI should expose a readable activity timeline.

Example:

```text
10:32 — Submitted by Maria
10:41 — Approved by John
11:03 — PO created by Maria
14:18 — Goods received by David
```

For sensitive changes:

```text
Changed Field
Before
After
Actor
Timestamp
```

Do not expose sensitive security information to unauthorized users.

---

# 20. Accounting UI

Accounting screens require high information accuracy.

## 20.1 Journal screen

```text
Journal Header
Date
Period
Source
Reference
Description

Journal Lines
Account | Description | Debit | Credit | Dimensions

Totals
Debit
Credit
Difference

Actions
Save Draft
Submit
Post
Reverse where applicable
```

## 20.2 Posting status

Clearly display:

```text
Draft
Pending Approval
Posted
Reversed
```

Posted records should visually communicate that they are historical/controlled records.

The PRD requires balanced journals, immutable posted lines, closed-period protection, traceable source data, linked reversals, reconciled AR/AP and inventory, reproducible valuation and payroll reconciliation. fileciteturn9file6L971-L1013

---

# 21. Financial Reporting UX

Report pages should support:

```text
date range
company
branch
department
warehouse
cost center
grouping
sorting
drill-down
export
saved configuration
```

These capabilities are explicitly required. fileciteturn9file1L84-L105

Drill-down pattern:

```text
Report
→ Account/Metric
→ Transaction list
→ Source document
→ Journal entry
```

This makes financial figures traceable to posted transactions.

---

# 22. Inventory UX

Inventory dashboards and pages should expose:

```text
Current quantity
Available quantity
Reserved quantity
On-order quantity
Reorder information
Warehouse
Location
Batch/serial
Movement history
Valuation where permitted
```

Stock movement detail:

```text
Source
Movement Type
Quantity
Warehouse
Location
Batch/Serial
Date
User
Related Document
```

---

# 23. HR UX

Employee profile:

```text
Personal
Employment
Organization
Manager
Compensation
Attendance
Leave
Documents
Activity
```

Employee header:

```text
Name
Employee Number
Job Title
Department
Branch
Employment Status
```

Sensitive compensation information must be permission-controlled.

---

# 24. Payroll UX

Payroll run page:

```text
Payroll Period
Pay Group
Employee Count
Gross Pay
Deductions
Taxes
Net Pay
Employer Cost
Exceptions
Status
```

Tabs:

```text
Summary
Employees
Exceptions
Accounting
Approval
Documents
Activity
```

Posting and payment actions should be visibly distinct.

---

# 25. Procurement UX

Procurement workspace should expose:

```text
Requests
RFQs
Supplier Quotations
Purchase Orders
Goods Receipts
Supplier Invoices
Payments
```

Useful dashboard metrics:

```text
Pending Requests
Pending Approvals
Open POs
Pending Receipts
Invoice Match Exceptions
Outstanding AP
```

---

# 26. Sales UX

Sales workspace:

```text
Customers
Quotations
Sales Orders
Deliveries
Invoices
Receipts
```

Useful dashboard metrics:

```text
Open Quotes
Orders Awaiting Approval
Pending Deliveries
Open AR
Overdue AR
```

---

# 27. Responsive Design

## 27.1 Desktop

Use:

```text
persistent sidebar
multi-column forms
wide data tables
split views where useful
```

## 27.2 Tablet

Use:

```text
collapsible navigation
responsive forms
horizontal table scrolling
adaptive action menus
```

## 27.3 Mobile

Prioritize:

```text
dashboard
approvals
notifications
critical record lookup
critical workflow actions
employee self-service
attendance
leave
```

Large tables should become:

```text
card/list representation
horizontal scrolling
or focused columns
```

Do not attempt to reproduce desktop density unchanged on mobile.

---

# 28. Accessibility

Use accessible components and semantic HTML.

Requirements:

```text
keyboard navigation
visible focus
accessible labels
accessible errors
screen-reader-friendly status
logical heading hierarchy
sufficient text/background contrast
non-color status indicators
dialog focus management
escape-to-close where appropriate
```

Every interactive control must have a meaningful accessible name.

Forms must connect validation messages to their controls.

Tables must preserve header relationships.

---

# 29. Keyboard UX

Provide keyboard-friendly workflows.

Global:

```text
Search shortcut
Navigation
Escape dialogs
Enter submit where safe
Tab logical order
Arrow navigation where component supports it
```

Tables:

```text
keyboard row focus
open selected record
```

Forms:

```text
logical tab sequence
```

Avoid keyboard shortcuts that could accidentally trigger destructive actions.

---

# 30. Loading States

Every asynchronous view must define a loading state.

Examples:

```text
Table skeleton
Card skeleton
Form submission spinner
Button loading state
Chart placeholder
```

Avoid blank screens.

For page-level loading, preserve layout structure to minimize visual shift.

---

# 31. Empty States

Every collection must have an intentional empty state.

Example:

```text
No Purchase Orders Yet

Create your first purchase order to begin the procurement workflow.

[Create Purchase Order]
```

Differentiate:

```text
No records exist
No records match filters
No permission
```

Do not display an empty table without explanation.

---

# 32. Error States

Error UX should distinguish:

```text
validation error
authorization error
not found
network error
server error
conflict
closed-period/business-rule error
```

Examples:

```text
403:
You do not have permission to perform this action.

404:
This record could not be found.

409:
This record changed while you were working. Refresh and review the latest version.
```

Clients receive safe, machine-readable errors while internal logs retain diagnostics. fileciteturn9file7L1175-L1177

---

# 33. Confirmation Patterns

Require confirmation for:

```text
delete
cancel
reject
reverse
post where appropriate
period close
irreversible administrative actions
```

Confirmation should explain:

```text
what will happen
whether it can be undone
why confirmation is required
```

Avoid confirmation dialogs for routine, reversible actions.

---

# 34. Toasts and Notifications

Use toasts for short-lived feedback:

```text
Saved
Submitted
Updated
Copied
Export started
```

Use persistent notification center for:

```text
approval requests
exceptions
system alerts
failed background jobs
important workflow events
```

Notification delivery should support templates, preferences, delivery status, retry, scheduling and event triggers. fileciteturn9file2L365-L389

---

# 35. Real-Time UX

Use WebSockets where real-time updates materially improve workflows.

Examples:

```text
chat
notifications
approval updates
job progress
live dashboard refresh
```

Real-time updates must still respect authorization.

If connection is lost:

```text
show connection state
continue safe local interaction
reconnect
refresh affected server state
```

---

# 36. Bulk Operations

Bulk operations must show:

```text
number selected
affected scope
action
confirmation
progress
success/failure summary
```

For large jobs:

```text
Create background job
→ show progress/status
→ notify completion
```

Never make a large export block the main browser request.

---

# 37. Pagination and Large Data

List endpoints must use pagination.

UX:

```text
Rows per page
Previous
Next
Page indicator
Total where available
```

For very large data sets, avoid loading the entire dataset into the browser.

Use server-side:

```text
filtering
sorting
pagination
search
aggregation
```

The architecture explicitly requires paginated APIs, indexed queries and efficient list endpoints. fileciteturn9file1L255-L266

---

# 38. Optimistic UI

Optimistic updates may be used only for low-risk interactions.

Good candidates:

```text
notification read/unread
preference toggles
UI-only state
```

Avoid optimistic financial or inventory mutations.

Financial/inventory state should update from authoritative server responses.

---

# 39. Concurrency UX

Critical financial and inventory operations require server-side concurrency control. The architecture specifically identifies inventory balances, numbering, payment allocation, payroll runs, period closing, financial posting and stock transfers as contention areas. fileciteturn9file7L1181-L1205

If a conflict occurs:

```text
Show conflict
→ Explain record changed
→ Offer refresh/review
→ Do not silently overwrite
```

---

# 40. Security UX

UI security behavior includes:

```text
permission-aware navigation
permission-aware actions
masked sensitive fields where required
secure file access
session timeout handling
MFA flows
account lockout messaging
safe error messages
export permission checks
```

The server remains the enforcement boundary.

The PRD requires server-side authorization, least privilege, secure secrets, audit logging, secure file access, input validation, rate limiting, secure authentication/session handling and protection against IDOR/BOLA. fileciteturn9file1L232-L243

---

# 41. AI-Ready UX

AI capabilities may be introduced after authorization and audit foundations are established.

Potential UI entry points:

```text
Ask ERP
Explain Report
Extract Document
Classify Invoice
Draft Correspondence
Summarize Meeting
Detect Exception
Workflow Assistant
Management Insight
Natural-Language Dashboard Query
```

AI must:

```text
respect permissions
respect company/branch scope
never bypass authorization
never directly mutate financial records outside controlled workflows
record sensitive AI-assisted actions where applicable
never expose secrets
never treat generated content as authoritative accounting data without validation
```

These constraints come directly from the supplied PRD. fileciteturn9file1L109-L136

---

# 42. Design Tokens

Use a centralized design-token layer rather than hard-coded visual values throughout features.

Token categories:

```text
colors
typography
spacing
radii
borders
shadows
control heights
breakpoints
z-index
motion
```

## 42.1 Color semantics

The design system should define semantic roles such as:

```text
background
surface
foreground
muted
border
primary
secondary
success
warning
danger
info
```

Status meaning must not depend on color alone.

## 42.2 Typography

Define:

```text
display
page title
section title
body
label
caption
table text
code/technical text
```

Maintain consistent hierarchy throughout modules.

## 42.3 Spacing

Use a consistent spacing scale.

Avoid arbitrary one-off margins in feature screens.

---

# 43. Component System

Shared components should include:

```text
Button
IconButton
Input
Textarea
Select
Combobox
DatePicker
DateRangePicker
Checkbox
Radio
Switch
Badge
Avatar
Tooltip
Popover
Dropdown
Dialog
Drawer
Tabs
Accordion
Breadcrumb
Pagination
DataTable
FilterBar
FormSection
FormField
Alert
Toast
Skeleton
EmptyState
ErrorState
Timeline
DocumentList
FileUploader
StatusBadge
MetricCard
ChartCard
```

Feature components should compose shared primitives rather than creating visually inconsistent replacements.

---

# 44. Page Templates

Standard page templates:

### List

```text
Breadcrumb
Title
Actions
Filter Bar
Table
Pagination
```

### Detail

```text
Breadcrumb
Header
Status
Actions
Tabs
Content
Activity
Related Records
```

### Form

```text
Breadcrumb
Title
Form Sections
Validation
Actions
```

### Dashboard

```text
Title
Context
KPIs
Alerts
Charts
Work Queue
Activity
```

### Report

```text
Title
Filters
Summary
Visualization/Table
Drill-down
Export
```

---

# 45. Module Navigation

Primary navigation should map to the ERP domains:

```text
Dashboard

My Work
  Approvals
  Tasks
  Notifications

HR
  Employees
  Attendance
  Leave
  Holidays
  Calendar

Payroll
  Pay Groups
  Salary Structures
  Payroll Runs
  Payslips

Procurement
  Suppliers
  Purchase Requests
  RFQs
  Quotations
  Purchase Orders
  Goods Receipts
  Supplier Invoices

Inventory
  Products
  Warehouses
  Stock
  Transfers
  Adjustments
  Valuation

Sales
  Customers
  Quotations
  Sales Orders
  Deliveries
  Invoices
  Receipts

Accounting
  Chart of Accounts
  Journals
  Vouchers
  General Ledger
  Daybook
  Accounts Receivable
  Accounts Payable
  Bank
  Cash
  Tax
  Financial Periods
  Financial Statements

Assets
  Asset Register
  Depreciation
  Transfers
  Disposal

Office
  Visitors
  Calls
  Correspondence
  File Room
  Documents

Communication
  Chat
  Email
  SMS
  WhatsApp
  Notifications

Reports
  Report Engine
  Dashboards
  Exports
  Scheduled Reports

Administration
  Users
  Roles
  Permissions
  Companies
  Branches
  Departments
  Warehouses
  Settings
  Audit
```

The architecture delivery strategy defines these module stages and areas. fileciteturn9file5L760-L884

---

# 46. Navigation Rules

Navigation must:

```text
preserve context
preserve filters where useful
support breadcrumbs
support deep links
support browser back/forward
avoid dead ends
open related records predictably
```

A user should be able to move:

```text
Purchase Invoice
→ Supplier
→ Purchase Order
→ Goods Receipt
→ Payment
→ Journal
```

without manually searching each record.

---

# 47. Document Numbering UX

Display human-readable identifiers prominently:

```text
PR-2026-000001
PO-2026-000001
GRN-2026-000001
INV-2026-000001
PAY-2026-000001
JE-2026-000001
```

The architecture requires centralized, concurrency-safe numbering that may depend on company, branch, document type, financial year, prefix and sequence. fileciteturn9file7L1209-L1233

---

# 48. Forms and Financial Precision

Money inputs should display:

```text
currency
decimal precision
thousand separators
negative values where permitted
```

Never use floating-point presentation as a substitute for backend financial precision.

For totals:

```text
Subtotal
Discount
Tax
Grand Total
```

Clearly distinguish:

```text
calculated
user-entered
server-authoritative
```

---

# 49. Date and Time UX

Display:

```text
organization-aware dates
timezone-aware timestamps
financial period context
```

For audit/activity:

```text
date
time
timezone where useful
```

Do not silently reinterpret historical timestamps in a different business context.

---

# 50. Mobile Critical Workflows

Prioritize these on mobile:

```text
Approval
Reject/Request Changes
Leave request
Attendance
Notification review
Record lookup
Customer/supplier lookup
Quick document access
```

Complex accounting data-entry screens may remain optimized primarily for larger screens while remaining usable on tablet/mobile where required.

---

# 51. Performance UX

The UI should:

```text
avoid unnecessary network requests
cache server state
paginate large lists
prefetch predictable navigation where useful
lazy-load heavy screens
load charts asynchronously
use skeletons
avoid layout shift
```

Long-running work should show job status instead of blocking the page.

---

# 52. Error Recovery

Every recoverable failure should provide an action.

Examples:

```text
Network error
→ Retry

Session expired
→ Sign in

Conflict
→ Refresh and review

Export failed
→ Retry / View job

Permission denied
→ Return to previous page

Record not found
→ Back to list
```

Never trap the user in an error state without navigation.

---

# 53. Destructive Action UX

For destructive operations:

```text
Delete
Cancel
Reject
Reverse
Close Period
Disable User
Terminate Employee
Dispose Asset
```

Show:

```text
clear action title
consequence
reason if required
Cancel
Confirm
```

For irreversible operations, explicitly communicate that the action is controlled or irreversible.

---

# 54. Audit-Friendly UX

Every sensitive workflow should make history discoverable:

```text
Activity
Workflow
Documents
Related Transactions
```

Do not make users inspect database-level audit logs for normal operational traceability.

Detailed audit administration remains available to authorized users.

---

# 55. Testing UX States

Every major page must be tested in:

```text
loading
empty
normal
filtered
large dataset
validation error
server error
permission denied
not found
offline/reconnect where applicable
mobile
tablet
desktop
keyboard navigation
```

Every critical workflow requires E2E coverage according to the PRD. fileciteturn9file1L209-L221

Critical E2E flows include:

```text
procure-to-pay
quote-to-cash
hire-to-pay
asset lifecycle
```

---

# 56. Frontend Definition of Done

A frontend feature is not complete merely because a route renders.

It must have, where applicable:

```text
real API integration
authorization behavior
scope behavior
loading state
empty state
error state
validation
successful submission
server-error handling
responsive layout
keyboard accessibility
document links
workflow actions
activity history
related records
tests
```

This matches the project definition that a module is not complete merely because its UI exists. fileciteturn9file3L584-L611

---

# 57. UI Build Sequence

Build the UI in the architecture's vertical-slice order:

```text
Foundation
↓
Core Platform
↓
HR
↓
Payroll
↓
Procurement
↓
Inventory
↓
Sales
↓
Accounting
↓
Office
↓
Communication
↓
Reporting
↓
Hardening
```

Within each slice:

```text
Database
→ Domain Model
→ Service
→ API
→ Authorization
→ Workflow
→ Accounting / Events
→ Frontend
→ Tests
→ Documentation
```

After every slice:

```text
Typecheck
→ Lint
→ Unit Tests
→ Integration Tests
→ E2E where applicable
→ Migration Verification
→ Production Build
```

The supplied architecture explicitly requires this vertical-slice approach and says not to proceed to the next unstable slice. fileciteturn9file3L542-L580

---

# 58. Final UX Acceptance

The UI layer is accepted when:

```text
1. The application feels like one coherent ERP.
2. Navigation is consistent.
3. Company/branch context is clear.
4. Unauthorized actions are not exposed as normal actions.
5. Server-side authorization remains authoritative.
6. Major lists have filters and pagination.
7. Major forms have validation and unsaved-change handling.
8. Major records have workflow/activity/related-record visibility.
9. Documents are linked to transactions.
10. Loading/empty/error states exist.
11. Critical workflows work on mobile.
12. Keyboard navigation works for critical interactions.
13. Financial screens emphasize accuracy and traceability.
14. Sensitive actions require appropriate confirmation.
15. Global search respects authorization.
16. Reports use authoritative backend data.
17. Critical workflows have E2E tests.
18. Production build succeeds.
19. Documentation matches implementation.
20. No UI-only implementation is treated as a completed business module.
```

The project's initial acceptance criteria also require authentication, permissions, server-side company/branch/department scope, audit records, file storage, base navigation, dashboard shell, tests, typecheck, linting and production build. fileciteturn9file0L14-L36

---

# 59. Next Document

**CLAUDE.md**

`CLAUDE.md` is the final project-level AI coding-agent contract. It will consolidate:

```text
source-of-truth hierarchy
architecture rules
coding rules
security rules
database rules
API rules
workflow rules
accounting rules
UI rules
testing gates
vertical-slice process
definition of done
Git rules
Claude Code operating instructions
```

It should be concise enough for an AI coding agent to load continuously while pointing back to the five detailed documents.
