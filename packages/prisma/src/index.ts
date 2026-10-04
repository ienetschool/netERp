import { PrismaClient } from '@prisma/client';

/**
 * Application-wide Prisma client singleton.
 *
 * The ERP never talks to the database through anything else — every module
 * goes through this client so transactions, scoping and logging stay uniform.
 */
export class PrismaService extends PrismaClient {
  constructor() {
    super({
      log: process.env.LOG_LEVEL === 'debug' ? ['query', 'warn', 'error'] : ['warn', 'error'],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Runs `operation` against a live connection.
   *
   * A pooled connection can be dropped by the server between statements, which
   * leaves the client holding a socket that will never recover. Reconnecting
   * and replaying once turns that blip into a transparent retry instead of a
   * 500 the caller has to interpret. Only connection failures are replayed —
   * a failed constraint or a rejected query must surface as it is, and a
   * transaction callback must never be replayed because its writes are unknown.
   */
  async withReconnect<T>(operation: (client: PrismaClient) => Promise<T>): Promise<T> {
    try {
      return await operation(this);
    } catch (error) {
      if (!isConnectionLoss(error)) throw error;
      await this.$connect().catch(() => {});
      return operation(this);
    }
  }
}

const CONNECTION_LOSS_CODES = new Set(['P1001', 'P1002', 'P1008', 'P1017']);

/** True for the Prisma codes that mean "the connection is gone", not "your query is wrong". */
export function isConnectionLoss(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string' && CONNECTION_LOSS_CODES.has(code)) return true;
  // A closed pooler socket sometimes surfaces with no Prisma code at all.
  const message = (error as { message?: unknown }).message;
  return (
    typeof message === 'string' &&
    /Server has closed the connection|Connection closed/i.test(message)
  );
}

export const prisma = new PrismaService();

export * from '@prisma/client';
export { Prisma } from '@prisma/client';
