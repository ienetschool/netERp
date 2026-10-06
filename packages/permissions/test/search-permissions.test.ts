import { describe, expect, it } from 'vitest';
import { SEARCH_ENTITY_PERMISSIONS, permittedSearchEntityTypes } from '../src/search.js';

describe('global-search permission map', () => {
  it('uses existing module view permissions for searchable records', () => {
    expect(SEARCH_ENTITY_PERMISSIONS.employee).toBe('hr.employee.view');
    expect(SEARCH_ENTITY_PERMISSIONS.purchase_order).toBe('procurement.purchase_order.view');
    expect(SEARCH_ENTITY_PERMISSIONS.sales_order).toBe('sales.sales_order.view');
    expect(SEARCH_ENTITY_PERMISSIONS.journal_entry).toBe('accounting.journal.view');
    expect(SEARCH_ENTITY_PERMISSIONS.document).toBe('documents.document.view');
  });

  it('returns only entity types whose view permission is granted', () => {
    expect(
      permittedSearchEntityTypes((permission) =>
        ['sales.customer.view', 'sales.sales_order.view'].includes(permission),
      ).sort(),
    ).toEqual(['customer', 'sales_order']);
  });

  it('does not grant access for unknown entity types', () => {
    expect(SEARCH_ENTITY_PERMISSIONS['secret_record']).toBeUndefined();
    expect(permittedSearchEntityTypes(() => true)).not.toContain('secret_record');
  });
});
