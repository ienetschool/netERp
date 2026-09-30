# Enterprise Office ERP — Data Model

**Document:** DATA-MODEL.md  
**Version:** 1.0  
**Status:** Baseline / Build Source  
**Companions:** PRD.md, ARCHITECTURE.md

> Canonical implementation contract for the ERP's persistent business data. It preserves the supplied project's multi-company, multi-branch, accounting-first, workflow-driven architecture.

## 1. Data Modeling Principles

The database prioritizes:

1. Referential integrity
2. Financial integrity
3. Transaction consistency
4. Scope isolation
5. Historical preservation
6. Auditability
7. Explicit relationships
8. Query performance
9. Extensibility
10. Safe migrations

PostgreSQL is authoritative; Prisma is the ORM and migration layer.

The model must never assume one company, branch, warehouse, department, currency, or financial period.

## 2. Logical Domains

```text
Platform
├── Identity
├── Organization
├── Authorization
├── Settings
├── Numbering
├── Workflow
├── Events
├── Notifications
├── Documents
├── Audit
└── Search

People
├── Employees
├── Attendance
├── Leave
├── Holidays
└── Payroll

Operations
├── Suppliers
├── Procurement
├── Products
├── Warehouses
├── Inventory
├── Customers
├── Sales
└── Fixed Assets

Finance
├── Chart of Accounts
├── Financial Periods
├── Journals
├── Journal Lines
├── General Ledger
├── Accounts Payable
├── Accounts Receivable
├── Cash
├── Bank
├── Payments
├── Receipts
├── Taxes
└── Reconciliation
```

## 3. Common Entity Conventions

Unless a domain requires otherwise:

```text
id
created_at
updated_at
created_by
updated_by
```

Use UUID internal identifiers. Business document numbers are separate:

```text
id          = UUID
document_no = INV-2026-000001
```

Do not use sequential database IDs as business document identity.

## 4. Organization

### Company

```text
id
code
name
legal_name
registration_number
tax_number
base_currency_id
timezone
address
phone
email
website
status
fiscal_year_start
settings
created_at
updated_at
```

Relationships:

```text
Company
├── branches
├── departments
├── warehouses
├── cost_centers
├── users/scopes
├── employees
├── customers
├── suppliers
├── financial_periods
├── chart_of_accounts
└── transactions
```

Constraint: `code` unique.

### Branch

```text
id
company_id
code
name
type
timezone
address
phone
email
manager_employee_id
status
```

Constraint:

```text
UNIQUE(company_id, code)
```

### Department

```text
id
company_id
branch_id
parent_department_id
code
name
manager_employee_id
cost_center_id
status
```

Supports hierarchical departments.

### Cost Center

```text
id
company_id
branch_id
code
name
description
manager_employee_id
status
```

### Warehouse

```text
id
company_id
branch_id
code
name
type
address
manager_employee_id
status
```

### Warehouse Location

```text
id
warehouse_id
code
name
parent_location_id
location_type
status
```

## 5. Identity and Authorization

### User

```text
id
username/email
display_name
phone
employee_id
password_hash
status
mfa_enabled
last_login_at
locked_until
created_at
updated_at
```

Authentication secrets are never stored in plaintext.

### Role

```text
id
name
code
description
is_system_role
status
```

Initial roles from the supplied specification include:

```text
Super Administrator
Company Administrator
Branch Manager
HR Manager
HR Officer
Accountant
Chief Accountant
Finance Manager
Purchase Officer
Procurement Manager
Inventory Manager
Sales Officer
Sales Manager
Receptionist
Document Officer
Employee
Auditor
Read Only
```

Custom roles are supported.

### Permission

Canonical model:

```text
module
resource
action
```

Examples:

```text
accounting.invoice.post
accounting.invoice.reverse
payroll.payroll_run.approve
inventory.stock.adjust
purchase.purchase_order.approve
```

Unique:

```text
UNIQUE(module, resource, action)
```

### User Role Assignment

```text
id
user_id
role_id
company_id nullable
branch_id nullable
department_id nullable
warehouse_id nullable
valid_from
valid_to
```

### User Scope

Support explicit:

```text
user_company_scopes
user_branch_scopes
user_department_scopes
user_warehouse_scopes
```

Users may have all or selected organizational scopes. Authorization combines role permissions with these scopes.

## 6. Employees

### Employee

```text
id
company_id
branch_id
department_id
employee_no
user_id nullable
first_name
middle_name
last_name
display_name
gender
date_of_birth
nationality
national_id
email
phone
address
hire_date
termination_date
employment_status
employment_type
job_title
manager_employee_id
cost_center_id
pay_group_id
bank_account_reference
tax_identifier
emergency_contact
status
```

Relationships:

```text
Employee
├── User
├── Attendance
├── Leave
├── Payroll
├── Documents
└── Manager
```

Sensitive personal information requires stricter access control.

Employee lifecycle:

```text
DRAFT → ACTIVE → ON_LEAVE / SUSPENDED → TERMINATED / RETIRED
```

Historical employment data is preserved.

## 7. Attendance and Leave

### Attendance

```text
id
employee_id
company_id
branch_id
attendance_date
clock_in
clock_out
worked_minutes
overtime_minutes
status
source
notes
approved_by
approved_at
```

Statuses:

```text
PRESENT
ABSENT
LATE
HALF_DAY
LEAVE
HOLIDAY
OFF_DAY
```

### Attendance Events

```text
id
employee_id
event_time
event_type
source
device_id
external_reference
raw_metadata
```

Raw device events remain separate from calculated attendance.

### Shift

```text
id
company_id
name
start_time
end_time
break_minutes
grace_minutes
overtime_rule_id
status
```

### Employee Shift Assignment

```text
employee_id
shift_id
effective_from
effective_to
```

### Leave Type

```text
id
company_id
code
name
description
paid
requires_attachment
requires_approval
annual_allowance
carry_forward
status
```

### Leave Request

```text
id
employee_id
leave_type_id
company_id
branch_id
start_date
end_date
requested_days
reason
status
submitted_at
approved_at
approved_by
rejected_at
rejected_by
```

Lifecycle:

```text
DRAFT → SUBMITTED → PENDING_APPROVAL → APPROVED
                           └→ REJECTED
```

### Holiday

```text
id
company_id
branch_id nullable
name
holiday_date
is_recurring
status
```

## 8. Payroll

### Pay Group

```text
id
company_id
name
frequency
currency_id
pay_day_rule
status
```

### Salary Structure

```text
id
company_id
name
currency_id
status
```

### Salary Component

```text
id
salary_structure_id
code
name
type
calculation_method
value
percentage
account_id
taxable
status
```

Types:

```text
EARNING
DEDUCTION
EMPLOYER_CONTRIBUTION
```

### Employee Salary Assignment

```text
id
employee_id
salary_structure_id
effective_from
effective_to
base_salary
currency_id
status
```

Salary history is effective-dated; historical records are not overwritten.

### Payroll Run

```text
id
company_id
branch_id nullable
pay_group_id
period_start
period_end
payment_date
currency_id
status
total_gross
total_deductions
total_net
total_employer_cost
approved_by
approved_at
posted_by
posted_at
```

Statuses:

```text
DRAFT
CALCULATING
CALCULATED
PENDING_APPROVAL
APPROVED
POSTED
PAID
CANCELLED
```

### Payroll Entry

```text
id
payroll_run_id
employee_id
gross_amount
deduction_amount
net_amount
employer_cost
status
```

### Payroll Line

```text
id
payroll_entry_id
salary_component_id
description
quantity
rate
amount
taxable
account_id
```

Payroll totals must reconcile to the underlying lines.

## 9. Procurement

### Supplier

```text
id
company_id
supplier_no
legal_name
display_name
tax_number
registration_number
email
phone
address
currency_id
payment_terms_id
default_payable_account_id
status
```

### Supplier Bank Account

```text
id
supplier_id
bank_name
account_name
account_number
routing/reference
currency_id
is_default
status
```

Banking information is restricted.

### Purchase Request

Header:

```text
id
company_id
branch_id
department_id
request_no
requested_by
required_date
purpose
status
workflow_instance_id
```

Lines:

```text
id
purchase_request_id
product_id nullable
description
quantity
unit_id
estimated_unit_cost
estimated_total
preferred_supplier_id nullable
```

### RFQ

```text
id
company_id
branch_id
rfq_no
purchase_request_id nullable
issue_date
response_due_date
status
```

RFQ suppliers and lines are separate entities.

### Supplier Quotation

Header:

```text
id
company_id
branch_id
quotation_no
supplier_id
rfq_id nullable
quotation_date
valid_until
currency_id
subtotal
tax_total
grand_total
status
```

Lines:

```text
id
quotation_id
product_id nullable
description
quantity
unit_id
unit_price
tax_id
tax_amount
line_total
```

### Purchase Order

Header:

```text
id
company_id
branch_id
department_id
warehouse_id nullable
po_no
supplier_id
rfq_id nullable
quotation_id nullable
order_date
expected_date
currency_id
payment_terms_id
subtotal
discount_total
tax_total
grand_total
status
workflow_instance_id
```

Lines:

```text
id
purchase_order_id
product_id nullable
description
quantity
unit_id
unit_price
discount
tax_id
tax_amount
line_total
received_quantity
billed_quantity
```

### Goods Receipt

Header:

```text
id
company_id
branch_id
warehouse_id
receipt_no
supplier_id
purchase_order_id
receipt_date
received_by
status
```

Lines:

```text
id
goods_receipt_id
purchase_order_line_id
product_id
warehouse_location_id
quantity
unit_id
batch_no nullable
serial_no nullable
unit_cost
```

### Supplier Invoice

Header:

```text
id
company_id
branch_id
supplier_id
supplier_invoice_no
internal_invoice_no
purchase_order_id nullable
goods_receipt_id nullable
invoice_date
due_date
currency_id
subtotal
tax_total
grand_total
status
posting_date
journal_entry_id nullable
```

Lines retain links to PO/receipt lines where applicable.

Three-way matching:

```text
Purchase Order + Goods Receipt + Supplier Invoice
```

## 10. Products and Inventory

### Product

```text
id
company_id
sku
barcode
name
description
category_id
brand_id nullable
product_type
base_unit_id
purchase_unit_id
sales_unit_id
track_batch
track_serial
inventory_item
saleable
purchasable
standard_cost
status
```

Product types:

```text
STOCK
SERVICE
NON_STOCK
ASSET
```

### Product Category

```text
id
company_id
parent_category_id
code
name
status
```

### Unit of Measure

```text
id
company_id nullable
code
name
symbol
precision
status
```

### Unit Conversion

```text
id
from_unit_id
to_unit_id
factor
```

### Inventory Accounting Configuration

May include:

```text
inventory_account_id
inventory_adjustment_account_id
cogs_account_id
sales_account_id
purchase_account_id
```

### Stock Balance

Logical dimensions:

```text
company_id
warehouse_id
warehouse_location_id
product_id
batch_id nullable
serial_id nullable
```

Quantities:

```text
on_hand_quantity
reserved_quantity
available_quantity
```

The stock movement ledger remains authoritative history.

### Stock Movement

```text
id
company_id
branch_id
warehouse_id
warehouse_location_id
product_id
movement_type
quantity
unit_cost
total_cost
reference_type
reference_id
reference_no
movement_date
posted_at
created_by
```

Types:

```text
RECEIPT
ISSUE
TRANSFER_IN
TRANSFER_OUT
ADJUSTMENT_IN
ADJUSTMENT_OUT
RETURN_IN
RETURN_OUT
```

Every movement must have a traceable source.

### Stock Transfer

Header:

```text
id
company_id
from_warehouse_id
to_warehouse_id
transfer_no
transfer_date
reason
status
```

Lines:

```text
id
stock_transfer_id
product_id
quantity
unit_id
```

A transfer creates paired out/in movements atomically.

### Stock Adjustment

Header:

```text
id
company_id
branch_id
warehouse_id
adjustment_no
reason
status
approved_by
posted_by
```

Lines:

```text
id
stock_adjustment_id
product_id
system_quantity
counted_quantity
difference_quantity
unit_cost
adjustment_value
```

### Batch / Serial

Batch:

```text
id
product_id
batch_no
manufacture_date
expiry_date
status
```

Serial:

```text
id
product_id
serial_no
status
warehouse_id
location_id
```

Tracked products must remain traceable.

## 11. Customers and Sales

### Customer

```text
id
company_id
customer_no
legal_name
display_name
tax_number
email
phone
address
currency_id
payment_terms_id
credit_limit
receivable_account_id
status
```

### Sales Quotation

Header:

```text
id
company_id
branch_id
quotation_no
customer_id
quotation_date
valid_until
currency_id
subtotal
discount_total
tax_total
grand_total
status
```

Lines:

```text
id
quotation_id
product_id
description
quantity
unit_id
unit_price
discount
tax_id
tax_amount
line_total
```

### Sales Order

Header:

```text
id
company_id
branch_id
warehouse_id
sales_order_no
customer_id
quotation_id nullable
order_date
requested_delivery_date
currency_id
payment_terms_id
subtotal
discount_total
tax_total
grand_total
status
```

Lines retain product, quantity, price, tax and fulfillment quantities.

### Delivery

Header:

```text
id
company_id
branch_id
warehouse_id
delivery_no
customer_id
sales_order_id
delivery_date
delivered_by
status
```

Lines link to sales-order lines and inventory locations.

### Customer Invoice

Header:

```text
id
company_id
branch_id
invoice_no
customer_id
sales_order_id nullable
delivery_id nullable
invoice_date
due_date
currency_id
subtotal
discount_total
tax_total
grand_total
status
posting_date
journal_entry_id nullable
```

Lines link to sales-order/delivery lines where applicable and contain revenue/tax accounts.

### Customer Receipt

```text
id
company_id
branch_id
receipt_no
customer_id
receipt_date
currency_id
amount
payment_method
bank_account_id nullable
cash_account_id nullable
status
journal_entry_id
```

Receipt allocation:

```text
id
receipt_id
invoice_id
allocated_amount
```

A receipt may allocate across multiple invoices.

## 12. Fixed Assets

### Asset

```text
id
company_id
branch_id
asset_no
name
description
asset_category_id
acquisition_date
capitalization_date
purchase_cost
residual_value
currency_id
useful_life
depreciation_method
status
location
custodian_employee_id
asset_account_id
accumulated_depreciation_account_id
depreciation_expense_account_id
```

Statuses:

```text
DRAFT
ACTIVE
FULLY_DEPRECIATED
TRANSFERRED
DISPOSED
```

### Asset Acquisition

```text
id
asset_id
source_type
source_id
supplier_id nullable
invoice_id nullable
acquisition_cost
acquisition_date
journal_entry_id
```

### Depreciation Schedule

```text
id
asset_id
period_id
depreciation_date
depreciation_amount
accumulated_depreciation
book_value
journal_entry_id
status
```

### Asset Transfer

```text
id
asset_id
from_branch_id
to_branch_id
from_department_id
to_department_id
from_cost_center_id
to_cost_center_id
transfer_date
reason
approved_by
status
```

Historical location/custodian data is preserved.

## 13. Accounting

### Chart of Accounts

```text
id
company_id
parent_account_id
account_code
account_name
account_type
normal_balance
currency_id nullable
is_control_account
is_postable
status
```

Types:

```text
ASSET
LIABILITY
EQUITY
REVENUE
EXPENSE
```

### Financial Period

```text
id
company_id
fiscal_year
period_no
start_date
end_date
status
closed_by
closed_at
```

Statuses:

```text
OPEN
CLOSING
CLOSED
```

Closed periods reject normal posting.

### Journal

```text
id
company_id
branch_id
journal_no
journal_type
journal_date
financial_period_id
source_type
source_id
source_document_no
description
status
posted_by
posted_at
reversed_by_journal_id nullable
```

Types:

```text
GENERAL
SALES
PURCHASE
CASH
BANK
PAYROLL
INVENTORY
ASSET
TAX
ADJUSTMENT
REVERSAL
```

### Journal Line

```text
id
journal_id
line_no
account_id
description
debit
credit
currency_id
exchange_rate
foreign_debit
foreign_credit
customer_id nullable
supplier_id nullable
employee_id nullable
product_id nullable
cost_center_id nullable
department_id nullable
branch_id nullable
project_id nullable
```

Invariant:

```text
SUM(debit) = SUM(credit)
```

for every posted journal.

### Accounting Source Link

Retain:

```text
source_module
source_entity
source_id
source_document_no
```

Examples include invoice→sales order, supplier invoice→PO/receipt, payroll journal→payroll run, inventory journal→stock movement, payment→supplier invoice, receipt→customer invoice.

## 14. AR / AP

### Accounts Payable Transaction

```text
id
company_id
supplier_id
supplier_invoice_id
journal_entry_id
transaction_date
due_date
original_amount
outstanding_amount
currency_id
status
```

Statuses:

```text
OPEN
PARTIALLY_PAID
PAID
VOID
```

### Accounts Receivable Transaction

```text
id
company_id
customer_id
invoice_id
journal_entry_id
transaction_date
due_date
original_amount
outstanding_amount
currency_id
status
```

AR/AP balances must reconcile to posted subsidiary transactions and their GL control accounts.

### Supplier Payment

```text
id
company_id
branch_id
payment_no
supplier_id nullable
payment_date
currency_id
amount
payment_method
bank_account_id nullable
cash_account_id nullable
status
journal_entry_id
```

Payment allocation:

```text
payment_id
supplier_invoice_id
allocated_amount
```

## 15. Cash, Bank and Reconciliation

### Cash Account

```text
id
company_id
branch_id
account_code
name
gl_account_id
currency_id
status
```

### Bank Account

```text
id
company_id
branch_id
bank_name
account_name
account_number_masked
currency_id
gl_account_id
status
```

### Bank Transaction

```text
id
bank_account_id
transaction_date
value_date
reference
description
debit
credit
balance
external_reference
reconciliation_status
```

### Reconciliation

```text
id
bank_transaction_id
journal_line_id
matched_amount
matched_at
matched_by
```

## 16. Taxes, Currency and Payment Terms

### Tax

```text
id
company_id
code
name
rate
tax_type
input_account_id
output_account_id
status
```

Types may include:

```text
SALES
PURCHASE
WITHHOLDING
PAYROLL
OTHER
```

Historical transactions preserve the tax rate/effect used at posting.

### Currency

```text
id
code
name
symbol
decimal_places
status
```

### Exchange Rate

```text
id
base_currency_id
quote_currency_id
rate
effective_at
source
```

### Payment Terms

```text
id
company_id
code
name
due_days
description
status
```

## 17. Workflow and Approval Data

### Workflow Definition

```text
id
company_id nullable
name
entity_type
version
status
```

### Workflow State

```text
id
workflow_definition_id
code
name
is_initial
is_terminal
```

### Workflow Transition

```text
id
workflow_definition_id
from_state_id
to_state_id
action
condition
```

### Workflow Instance

```text
id
workflow_definition_id
entity_type
entity_id
current_state
started_at
completed_at
```

### Approval Task

```text
id
workflow_instance_id
step
approver_type
approver_id
status
due_at
acted_at
comments
rejection_reason
```

Approval rules can depend on:

```text
user
role
branch
department
amount
document_type
```

## 18. Documents

### Document

```text
id
company_id
branch_id nullable
document_type
title
description
storage_key
filename
mime_type
size_bytes
content_hash
version
access_policy
created_by
created_at
```

### Document Link

```text
document_id
entity_type
entity_id
relationship_type
```

### Document Version

```text
id
document_id
version_no
storage_key
content_hash
size_bytes
uploaded_by
uploaded_at
change_reason
```

Document versions are immutable. Binary content lives in object storage; metadata lives in PostgreSQL.

## 19. Audit

```text
id
company_id nullable
branch_id nullable
actor_user_id
action
resource_type
resource_id
request_id
timestamp
ip_address
user_agent
before_data
after_data
metadata
```

Audit is append-oriented and protected from ordinary modification.

Sensitive operations include authentication, permission changes, employee/payroll changes, financial posting/reversal, inventory adjustments, document access, approvals, configuration changes, integrations and exports.

## 20. Notifications

### Notification

```text
id
user_id
company_id
type
title
message
resource_type
resource_id
channel
status
read_at
created_at
```

### Delivery

```text
id
notification_id
provider
attempt
status
provider_reference
error_code
sent_at
```

### Preference

```text
id
user_id
event_type
channel
enabled
```

## 21. Events / Outbox

```text
id
event_type
aggregate_type
aggregate_id
payload
occurred_at
published_at
attempts
status
last_error
```

Important business transactions may commit:

```text
business record
+
audit record
+
outbox event
```

in one database transaction, after which a worker publishes/processes the event.

## 22. Communication and Office

### Chat

Conversation:

```text
id
company_id
type
name
created_by
created_at
```

Participant:

```text
conversation_id
user_id
role
joined_at
```

Message:

```text
id
conversation_id
sender_user_id
message_type
content
attachment_document_id
created_at
edited_at
deleted_at
```

### Visitor

```text
id
company_id
branch_id
visitor_no
name
company_name
phone
email
host_employee_id
purpose
check_in_at
check_out_at
status
```

### Call Log

```text
id
company_id
branch_id
caller_name
caller_phone
recipient_employee_id
subject
notes
call_time
direction
status
```

### Correspondence

```text
id
company_id
branch_id
correspondence_no
direction
correspondence_type
sender
recipient
subject
received_at
sent_at
assigned_to
status
document_id
```

Directions:

```text
INCOMING
OUTGOING
INTERNAL
```

### Calendar Event

```text
id
company_id
branch_id nullable
title
description
start_at
end_at
timezone
location
created_by
event_type
status
```

Participants are stored separately.

## 23. Reporting and Search

### Report Definition

```text
id
company_id nullable
name
code
description
module
query_definition
permission
status
```

### Saved Report

```text
id
user_id
report_definition_id
name
filters
columns
sorting
grouping
```

### Scheduled Report

```text
id
report_definition_id
owner_user_id
schedule
timezone
filters
output_format
delivery_channel
recipient_configuration
status
next_run_at
```

Large report generation is asynchronous.

### Search Document

```text
id
company_id
branch_id nullable
entity_type
entity_id
title
subtitle
search_text
metadata
updated_at
```

Search must apply authorization and scope before returning results.

## 24. Cross-Module Relationships

Procure-to-pay:

```text
Purchase Request
    ↓
RFQ
    ↓
Supplier Quotation
    ↓
Purchase Order
    ↓
Goods Receipt
    ↓
Supplier Invoice
    ↓
Payment
    ↓
Journal Entry
```

Quote-to-cash:

```text
Sales Quotation
    ↓
Sales Order
    ↓
Delivery
    ↓
Customer Invoice
    ↓
Receipt
    ↓
Journal Entry
```

Every downstream record should preserve explicit foreign keys when a strong relationship exists. Generic source linkage may additionally retain:

```text
source_module
source_entity
source_id
source_document_no
```

## 25. Accounting Relationships

Purchase invoice:

```text
Supplier Invoice
→ AP
+ Expense / Inventory
+ Tax
+ GL
```

Sales invoice:

```text
Customer Invoice
→ AR
+ Revenue
+ Tax
+ Inventory / COGS where applicable
+ GL
```

Payroll:

```text
Payroll Run
→ Payroll Liabilities
+ Salary Expense
+ Employer Costs
+ GL
```

Inventory:

```text
Goods Receipt
→ Stock Movement
+ Inventory Valuation
```

Payment:

```text
Supplier Payment
→ AP reduction
+ Bank/Cash reduction
+ GL
```

Receipt:

```text
Customer Receipt
→ AR reduction
+ Bank/Cash increase
+ GL
```

Assets:

```text
Asset Purchase
→ Fixed Asset
+ AP/Cash
+ GL

Depreciation
→ Depreciation Expense
+ Accumulated Depreciation
+ GL
```

## 26. Immutable Financial Data

Posted records are historical facts.

Do not silently edit or delete:

```text
Posted Journal
Posted Journal Line
Posted AR Transaction
Posted AP Transaction
Posted Inventory Valuation
Posted Payroll Accounting
Posted Asset Depreciation
```

Corrections use controlled reversals, credit/debit notes, adjustment journals, or legally appropriate cancellation.

## 27. Referential Integrity

Important foreign keys include:

```text
Branch → Company
Department → Branch
Warehouse → Branch
Employee → Company / Branch / Department
User → Employee
Purchase Order → Supplier / Company / Branch
Goods Receipt → Purchase Order
Supplier Invoice → Supplier / PO
Sales Order → Customer
Delivery → Sales Order
Customer Invoice → Customer
Receipt → Customer Invoice
Journal → Company / Financial Period
Journal Line → Journal / Account
Payroll Entry → Payroll Run / Employee
Asset → Company / Branch
Depreciation → Asset / Financial Period
```

Use true database foreign keys whenever a relationship is authoritative.

## 28. Uniqueness

Important constraints:

```text
Company.code
Branch(company_id, code)
Department(company_id, code)
Warehouse(company_id, code)
Employee(company_id, employee_no)
Product(company_id, sku)
Customer(company_id, customer_no)
Supplier(company_id, supplier_no)
Account(company_id, account_code)
```

Document numbering must be unique within its configured scope/year.

## 29. Indexing

Common indexes:

```text
company_id
branch_id
department_id
warehouse_id
status
created_at
updated_at
document_no
employee_id
supplier_id
customer_id
product_id
financial_period_id
```

Likely composite indexes:

```text
(company_id, branch_id, status)
(company_id, supplier_id, status)
(company_id, customer_id, status)
(warehouse_id, product_id)
(financial_period_id, account_id)
(employee_id, attendance_date)
```

Validate indexes against real query plans.

## 30. Soft Delete and History

Do not mechanically soft-delete every table.

For master data, prefer:

```text
ACTIVE / INACTIVE
```

where history matters.

Posted financial data is not deleted.

Documents may use archival/retention state.

Use effective-dated records for salary, organizational assignment, tax configuration, exchange rates and approval authority where historical reproducibility matters.

## 31. Monetary Rules

Use exact decimal semantics:

```text
PostgreSQL NUMERIC
+
Decimal-aware application arithmetic
```

Never use JavaScript binary floating point for authoritative financial calculations.

Store applicable:

```text
currency_id
amount
exchange_rate
```

Foreign-currency postings retain the rate used at posting time.

## 32. Scope Isolation

Every applicable query evaluates:

```text
user permissions
+
company scope
+
branch scope
+
department scope
+
warehouse scope
```

Changing a frontend company selector never grants access.

## 33. API Exposure

DTOs must separate public, internal and sensitive fields.

Do not broadly return:

- password hashes
- authentication secrets
- full bank credentials
- sensitive employee identifiers
- internal security metadata

## 34. Migration Strategy

Every schema change uses a versioned Prisma migration:

```text
Schema change
→ migration
→ review
→ local migration
→ seed/test verification
→ CI
→ staging
→ production
```

Destructive migrations require a documented data migration/recovery plan.

For production compatibility prefer:

```text
Add field
→ deploy compatible code
→ backfill
→ switch reads/writes
→ remove obsolete field later
```

## 35. Seed Order

Development seed data should establish:

```text
Currency
Company
Branches
Departments
Warehouses
Roles
Permissions
Admin User
Financial Period
Chart of Accounts
Products
Suppliers
Customers
Employees
```

No real credentials or sensitive production data.

## 36. Data Validation Layers

```text
Frontend UX validation
        ↓
API DTO validation
        ↓
Domain business rules
        ↓
Database constraints
```

Each layer serves a different purpose.

## 37. Mandatory Data Invariants

```text
Journal debits = credits.

Closed periods reject normal posting.

Stock movement references valid product and warehouse.

Inventory quantities are traceable to movements.

AR reconciles to posted customer transactions.

AP reconciles to posted supplier transactions.

Payroll totals reconcile to payroll lines.

Document links reference valid source entities.

Cross-company references are prohibited unless explicitly supported.

Unauthorized users cannot retrieve out-of-scope records.
```

## 38. Implementation Order

```text
1. Currency
2. Company
3. Branch
4. Department
5. Cost Center
6. Warehouse
7. Identity
8. Roles / Permissions
9. Users / Scopes
10. Employees
11. Financial Periods
12. Chart of Accounts
13. Products / Units
14. Suppliers
15. Customers
16. Procurement
17. Inventory
18. Sales
19. Payroll
20. Fixed Assets
21. Journals / GL
22. AR / AP
23. Cash / Bank
24. Taxes
25. Documents
26. Workflow
27. Notifications
28. Events / Outbox
29. Audit
30. Reporting metadata
31. Search
```

This order minimizes circular migration dependencies.

## 39. Definition of Done

The data model is ready when:

- Every PRD module has an owner entity.
- Cross-module relationships are explicit.
- Company/branch scope is defined.
- Financial entities are identified.
- Posted financial entities are immutable.
- Workflow entities exist.
- Audit entities exist.
- Document metadata exists.
- Event/outbox structures exist.
- Primary and foreign keys are defined.
- Unique constraints are identified.
- Important indexes are identified.
- Monetary fields use decimal semantics.
- Currency behavior is defined.
- Historical/effective-dated data is defined.
- Migration order is defined.
- Seed order is defined.
- Authorization-relevant scope fields are defined.

## 40. Source Alignment

This model follows the supplied project requirements for:

- modular domain boundaries
- multi-company / multi-branch structure
- users, roles and permissions
- workflow/approval engine
- procurement
- inventory
- sales
- payroll
- fixed assets
- accounting
- AR/AP
- cash/bank
- documents
- audit/compliance
- notifications/events
- reporting

The source specification also requires explicit cross-module document links and accounting as the financial source of truth. Those requirements are represented directly here.

## 41. Next Document

**`USER-FLOWS.md`**

That document will define every major business journey, lifecycle state, transition, approval path, exception, posting effect, inventory effect, notification trigger, audit event, required permission and end-to-end acceptance journey so the coding agent does not invent missing workflow logic.
