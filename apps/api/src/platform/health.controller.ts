import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '@erp/prisma';
import { Redis } from 'ioredis';

/**
 * Health/readiness (ARCHITECTURE.md §56). Liveness never touches dependencies;
 * readiness verifies PostgreSQL and Redis explicitly.
 */
@Controller('health')
export class HealthController {
  private readonly redis?: Redis;

  constructor(private readonly prisma: PrismaService) {
    if (process.env.REDIS_URL) {
      this.redis = new Redis(process.env.REDIS_URL, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        connectTimeout: 1500,
      });
      this.redis.on('error', () => {
        // readiness probes report status; avoid unhandled error events
      });
    }
  }

  @Get('live')
  live(): { status: 'up' } {
    return { status: 'up' };
  }

  @Get('ready')
  async ready(): Promise<{
    status: 'up' | 'degraded';
    checks: Record<string, boolean>;
  }> {
    const checks: Record<string, boolean> = {};
    checks.postgres = await this.prisma.isHealthy();
    if (this.redis) {
      try {
        if (this.redis.status === 'end' || this.redis.status === 'close') {
          await this.redis.connect().catch(() => undefined);
        }
        const pong: string = await this.redis.ping();
        checks.redis = pong.includes('PONG');
      } catch {
        checks.redis = false;
      }
    }
    const allUp = Object.values(checks).every(Boolean);
    return { status: allUp ? 'up' : 'degraded', checks };
  }
}
