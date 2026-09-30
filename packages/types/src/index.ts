export * from './money.js';

/** Consistent success envelope (CLAUDE.md §20, ARCHITECTURE.md §11). */
export interface ApiEnvelope<T> {
  data: T;
  meta: {
    requestId: string;
    [key: string]: unknown;
  };
}

export interface PaginatedEnvelope<T> {
  data: T[];
  meta: {
    page: number;
    pageSize: number;
    total: number;
    requestId: string;
  };
}

/** Machine-readable error body (safe for production clients). */
export interface ApiErrorBody {
  success: false;
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

/** Common workflow states (USER-FLOWS.md §2.1) — subsets per entity. */
export const WorkflowStates = {
  DRAFT: 'DRAFT',
  SUBMITTED: 'SUBMITTED',
  UNDER_REVIEW: 'UNDER_REVIEW',
  APPROVED: 'APPROVED',
  CHANGES_REQUESTED: 'CHANGES_REQUESTED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
  READY_TO_PROCESS: 'READY_TO_PROCESS',
  PROCESSED: 'PROCESSED',
  POSTED: 'POSTED',
  REVERSED: 'REVERSED',
} as const;

export type WorkflowState = (typeof WorkflowStates)[keyof typeof WorkflowStates];

export interface RequestPrincipal {
  userId: string;
  email: string;
  permissions: string[];
  companyIds: string[] | null; // null = all companies (platform scope)
  branchIds: string[] | null; // null = all branches within company scope
  departmentIds: string[] | null;
  warehouseIds: string[] | null;
}

export type DateOnlyString = string; // YYYY-MM-DD
export type IsoDateTimeString = string;
