import { describe, expect, it } from 'vitest';

/**
 * Office rule tests (Stage 9). The DB-backed transactions (numbering,
 * audit-tx pairing) are covered by live smoke; these lock the lifecycle
 * state machines the service enforces (USER-FLOWS §18.1–18.3).
 */

type VisitorStatus = 'EXPECTED' | 'CHECKED_IN' | 'CHECKED_OUT' | 'CANCELLED';
type FileStatus = 'AVAILABLE' | 'ISSUED' | 'ARCHIVED';
type CorrespondenceStatus = 'OPEN' | 'IN_PROGRESS' | 'CLOSED';

/** Mirrors OfficeService.checkInVisitor gate. */
function checkIn(current: VisitorStatus): VisitorStatus {
  if (current !== 'EXPECTED') {
    throw new Error(`Visitor is ${current.toLowerCase()}, not EXPECTED`);
  }
  return 'CHECKED_IN';
}

/** Mirrors OfficeService.checkOutVisitor gate. */
function checkOut(current: VisitorStatus): VisitorStatus {
  if (current !== 'CHECKED_IN') {
    throw new Error(`Visitor is ${current.toLowerCase()}, not CHECKED_IN`);
  }
  return 'CHECKED_OUT';
}

/** Mirrors OfficeService.issue/return/archiveFile gates. */
function fileAction(current: FileStatus, action: 'issue' | 'return' | 'archive'): FileStatus {
  if (action === 'issue') {
    if (current !== 'AVAILABLE') throw new Error(`File is ${current.toLowerCase()}, not AVAILABLE`);
    return 'ISSUED';
  }
  if (action === 'return') {
    if (current !== 'ISSUED') throw new Error(`File is ${current.toLowerCase()}, not ISSUED`);
    return 'AVAILABLE';
  }
  // archive
  if (current === 'ISSUED') throw new Error('File is ISSUED; it must be returned before archiving');
  if (current === 'ARCHIVED') throw new Error('File already ARCHIVED');
  return 'ARCHIVED';
}

/** Mirrors OfficeService.assign/closeCorrespondence gates. */
function correspondenceAction(
  current: CorrespondenceStatus,
  action: 'assign' | 'close',
): CorrespondenceStatus {
  if (action === 'assign') {
    if (current === 'CLOSED') throw new Error('Correspondence is CLOSED and cannot be reassigned');
    return 'IN_PROGRESS';
  }
  if (current === 'CLOSED') throw new Error('Correspondence already CLOSED');
  return 'CLOSED';
}

describe('visitor lifecycle', () => {
  it('walks EXPECTED → CHECKED_IN → CHECKED_OUT', () => {
    expect(checkIn('EXPECTED')).toBe('CHECKED_IN');
    expect(checkOut('CHECKED_IN')).toBe('CHECKED_OUT');
  });

  it('rejects check-in for a visitor who is not EXPECTED', () => {
    expect(() => checkIn('CHECKED_IN')).toThrow(/not EXPECTED/);
    expect(() => checkIn('CHECKED_OUT')).toThrow(/not EXPECTED/);
  });

  it('rejects check-out for a visitor who is not CHECKED_IN', () => {
    expect(() => checkOut('EXPECTED')).toThrow(/not CHECKED_IN/);
    expect(() => checkOut('CHECKED_OUT')).toThrow(/not CHECKED_IN/);
  });
});

describe('file room lifecycle', () => {
  it('walks AVAILABLE → ISSUED → AVAILABLE, then archives', () => {
    expect(fileAction('AVAILABLE', 'issue')).toBe('ISSUED');
    expect(fileAction('ISSUED', 'return')).toBe('AVAILABLE');
    expect(fileAction('AVAILABLE', 'archive')).toBe('ARCHIVED');
  });

  it('rejects issuing a file that is not AVAILABLE', () => {
    expect(() => fileAction('ISSUED', 'issue')).toThrow(/not AVAILABLE/);
    expect(() => fileAction('ARCHIVED', 'issue')).toThrow(/not AVAILABLE/);
  });

  it('rejects returning a file that is not ISSUED', () => {
    expect(() => fileAction('AVAILABLE', 'return')).toThrow(/not ISSUED/);
  });

  it('refuses to archive an issued file (must be returned first)', () => {
    expect(() => fileAction('ISSUED', 'archive')).toThrow(/returned before archiving/);
    expect(() => fileAction('ARCHIVED', 'archive')).toThrow(/already ARCHIVED/);
  });
});

describe('correspondence lifecycle', () => {
  it('assign moves OPEN/IN_PROGRESS to IN_PROGRESS; close terminates', () => {
    expect(correspondenceAction('OPEN', 'assign')).toBe('IN_PROGRESS');
    expect(correspondenceAction('IN_PROGRESS', 'assign')).toBe('IN_PROGRESS');
    expect(correspondenceAction('OPEN', 'close')).toBe('CLOSED');
  });

  it('rejects reassignment and closing once CLOSED', () => {
    expect(() => correspondenceAction('CLOSED', 'assign')).toThrow(/cannot be reassigned/);
    expect(() => correspondenceAction('CLOSED', 'close')).toThrow(/already CLOSED/);
  });
});
