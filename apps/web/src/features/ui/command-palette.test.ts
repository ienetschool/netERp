import { describe, expect, it } from 'vitest';
import {
  flattenNavigation,
  groupSearchResults,
  notificationDestination,
  searchDestination,
} from '@/lib/command-palette';
import { NAVIGATION } from '@/lib/navigation';

describe('command palette helpers', () => {
  it('shows only destinations allowed by the current permission predicate', () => {
    const visible = flattenNavigation(NAVIGATION, (permission) => permission === 'sales.customer.view');
    expect(visible.map((item) => item.label)).not.toContain('Sales');
    expect(visible.map((item) => item.label)).toContain('Customers');
    expect(visible.map((item) => item.label)).not.toContain('Journals');
    expect(visible.map((item) => item.label)).not.toContain('Users');
  });

  it('does not expose a group whose own grant is missing, even when a child grant is present', () => {
    const visible = flattenNavigation(NAVIGATION, (permission) => permission === 'hr.leave.view');
    expect(visible.map((item) => item.label)).not.toContain('HR');
    expect(visible.map((item) => item.label)).not.toContain('Leave');
  });

  it('keeps authorized search results grouped and sorts within each group', () => {
    const groups = groupSearchResults({
      customers: [
        { entityType: 'customer', entityId: '2', title: 'Zen Works', subtitle: 'C-2' },
        { entityType: 'customer', entityId: '1', title: 'Acme', subtitle: 'C-1' },
      ],
      suppliers: [{ entityType: 'supplier', entityId: '3', title: 'Parts Co', subtitle: 'S-3' }],
    });
    expect(groups.map((group) => group.label)).toEqual(['customers', 'suppliers']);
    expect(groups[0]?.results.map((result) => result.title)).toEqual(['Acme', 'Zen Works']);
  });

  it('opens search results in a real list without inventing query filters', () => {
    expect(
      searchDestination({
        entityType: 'sales_order',
        entityId: 'id',
        title: 'SO-2026-0001',
        subtitle: 'Acme',
      }),
    ).toBe('/sales/orders');
  });

  it('uses only safe notification destinations the user may access', () => {
    const can = (permission: string) => permission === 'hr.employee.view';
    expect(notificationDestination('employee', can)).toBe('/hr/employees');
    expect(notificationDestination('journal_entry', can)).toBeNull();
    expect(notificationDestination('workflow_instance', can)).toBeNull();
    expect(notificationDestination('../admin/users', can)).toBeNull();
    expect(notificationDestination(null, can)).toBeNull();
  });

  it('resolves the Prisma resource types the notifications API actually emits', () => {
    // Live data carries model names such as `message` and `report_export`;
    // keying only off search entity types left every row without a link.
    const can = () => true;
    expect(notificationDestination('message', can)).toBe('/communication/chat');
    expect(notificationDestination('report_export', can)).toBe('/reports');
    expect(notificationDestination('call_log', can)).toBe('/office/calls');
    expect(notificationDestination('leave_request', can)).toBe('/hr/leave');
    expect(notificationDestination('approval_task', can)).toBe('/approvals');

    const chatOnly = (permission: string) => permission === 'communication.chat.view';
    expect(notificationDestination('message', chatOnly)).toBe('/communication/chat');
    expect(notificationDestination('report_export', chatOnly)).toBeNull();
  });

  it('fails closed for unknown entity types without a route', () => {
    expect(
      searchDestination({ entityType: 'unmapped', entityId: 'id', title: 'secret', subtitle: null }),
    ).toBeNull();
  });
});
