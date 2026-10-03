/**
 * The report engine is deliberately framework-free (no Nest, no Prisma) so it
 * can be shared by the API and the worker and unit-tested in isolation. It
 * therefore raises its own error type; the API maps it onto its HTTP taxonomy
 * in reporting.service.ts, and the worker treats it as a failed run.
 */
export class ReportRuleError extends Error {
  readonly code = 'REPORT_RULE_ERROR';

  constructor(message: string) {
    super(message);
    this.name = 'ReportRuleError';
  }
}

export function isReportRuleError(error: unknown): error is ReportRuleError {
  return error instanceof ReportRuleError;
}
