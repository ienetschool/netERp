import { Injectable } from '@nestjs/common';
import { PrismaService } from '@erp/prisma';
import { BusinessRuleError, NotFoundError } from '../common/errors.js';
import type { Prisma } from '@erp/prisma';

type SettingValue = string | number | boolean | Record<string, unknown> | unknown[] | null;

/** Validates a payload against its declared value type. */
export function coerceSettingValue(valueType: string, value: unknown): SettingValue {
  switch (valueType) {
    case 'string':
      if (typeof value !== 'string') throw new BusinessRuleError('Expected a string value');
      return value;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new BusinessRuleError('Expected a finite number value');
      }
      return value;
    case 'boolean':
      if (typeof value !== 'boolean') throw new BusinessRuleError('Expected a boolean value');
      return value;
    case 'json':
      if (value === null || value === undefined) return null;
      if (typeof value === 'object') return value as SettingValue;
      throw new BusinessRuleError('Expected a JSON object or array value');
    default:
      throw new BusinessRuleError(`Unknown value type ${valueType}`);
  }
}

/**
 * Settings engine (PRD Stage 2: Settings). Platform-level settings use
 * companyId NULL; a per-company row with the same key overrides it.
 */
@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve<T = SettingValue>(key: string, companyId?: string | null): Promise<T | null> {
    const rows = await this.prisma.systemSetting.findMany({
      where: { key, OR: [{ companyId: null }, ...(companyId ? [{ companyId }] : [])] },
      orderBy: [{ companyId: { sort: 'asc', nulls: 'last' } }],
    });
    const specific = rows.find((r) => r.companyId === companyId && companyId !== null);
    if (specific) return specific.value as T;
    const platform = rows.find((r) => r.companyId === null);
    return platform ? (platform.value as T) : null;
  }

  async upsert(
    input: {
      key: string;
      value: unknown;
      valueType: string;
      companyId?: string | null;
      description?: string | undefined;
    },
    actorUserId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<{ id: string; key: string; valueType: string }> {
    const client = tx ?? this.prisma;
    const value = coerceSettingValue(input.valueType, input.value);
    if (input.valueType === 'json' && Array.isArray(value)) {
      throw new BusinessRuleError('JSON settings must be objects, not arrays');
    }
    const companyId = input.companyId ?? null;
    const existing = await client.systemSetting.findFirst({
      where: { key: input.key, companyId },
    });
    if (existing) {
      const row = await client.systemSetting.update({
        where: { id: existing.id },
        data: {
          value: value as Prisma.InputJsonValue,
          valueType: input.valueType,
          description: input.description ?? undefined,
          updatedById: actorUserId,
        },
      });
      return { id: row.id, key: row.key, valueType: row.valueType };
    }
    const row = await client.systemSetting.create({
      data: {
        key: input.key,
        value: value as Prisma.InputJsonValue,
        valueType: input.valueType,
        companyId,
        description: input.description ?? undefined,
        updatedById: actorUserId,
      },
    });
    return { id: row.id, key: row.key, valueType: row.valueType };
  }

  async list(companyId?: string | null): Promise<unknown[]> {
    return this.prisma.systemSetting.findMany({
      where: companyId ? { OR: [{ companyId: null }, { companyId }] } : { companyId: null },
      orderBy: [{ key: 'asc' }],
    });
  }

  async getOrFail(key: string, companyId?: string | null): Promise<SettingValue> {
    const value = await this.resolve(key, companyId);
    if (value === null) throw new NotFoundError(`Setting ${key} not found`);
    return value;
  }

  async findById(
    id: string,
  ): Promise<{ id: string; companyId: string | null; key: string } | null> {
    return this.prisma.systemSetting.findUnique({
      where: { id },
      select: { id: true, companyId: true, key: true },
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.systemSetting.delete({ where: { id } });
  }
}
