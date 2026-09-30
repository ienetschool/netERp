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
}

export const prisma = new PrismaService();

export * from '@prisma/client';
export { Prisma } from '@prisma/client';
