import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'crypto';
import argon2 from 'argon2';
import { PrismaService } from '@erp/prisma';
import {
  AuthenticationError,
  AuthorizationError,
  BusinessRuleError,
  NotFoundError,
} from '../common/errors.js';
import { AuditService } from '../common/audit.service.js';
import type { RequestPrincipal } from '../common/request-context.js';
import { resolveAccess } from './principal.js';

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const ACCESS_TTL_SECONDS = Number(process.env.JWT_ACCESS_TTL_SECONDS ?? 900);
const REFRESH_TTL_SECONDS = Number(process.env.JWT_REFRESH_TTL_SECONDS ?? 1209600);

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: number;
}

/**
 * Identity only. Permissions and scope are resolved per request by JwtAuthGuard
 * — embedding them here produced a ~40 KB token that HTTP stacks reject with 431.
 */
interface AccessTokenClaims {
  sub: string;
  email: string;
  sid: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  async validateLocalLogin(
    email: string,
    password: string,
  ): Promise<{ user: { id: string; email: string } }> {
    const user = await this.prisma.withReconnect((db) =>
      db.user.findUnique({
        where: { email: email.toLowerCase().trim() },
      }),
    );
    if (!user) {
      // Constant-ish time: still run a hash comparison to blunt user enumeration.
      await argon2.verify(
        '$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHRzb21lc2FsdA$Z0bGCQJbAO9CvBcFVjKz0k1r2Z6WlN4mQ0a7sT1uXvY',
        password,
      );
      throw new AuthenticationError('Invalid email or password');
    }

    if (user.status === 'DISABLED') {
      throw new AuthorizationError('Account is disabled');
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new AuthorizationError('Account is temporarily locked. Try again later.');
    }

    const valid = await argon2.verify(user.passwordHash, password);
    if (!valid) {
      const attempts = user.failedLoginAttempts + 1;
      const locked = attempts >= MAX_FAILED_ATTEMPTS;
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: attempts,
          ...(locked
            ? { status: 'LOCKED', lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000) }
            : {}),
        },
      });
      if (locked) {
        this.audit
          .record({
            actorUserId: user.id,
            action: 'auth.account_locked',
            resourceType: 'user',
            resourceId: user.id,
          })
          .catch(() => undefined);
        throw new AuthorizationError('Account is temporarily locked. Try again later.');
      }
      throw new AuthenticationError('Invalid email or password');
    }

    if (user.status === 'LOCKED') {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { status: 'ACTIVE', failedLoginAttempts: 0, lockedUntil: null },
      });
    }

    return { user: { id: user.id, email: user.email } };
  }

  async issueTokenPair(
    user: { id: string; email: string },
    meta: { ip?: string | null; userAgent?: string | null },
  ): Promise<TokenPair> {
    const sessionId = randomBytes(16).toString('hex');
    const accessToken = await this.jwt.signAsync({
      sub: user.id,
      email: user.email,
      sid: sessionId,
    } satisfies AccessTokenClaims);

    const refreshToken = randomBytes(48).toString('base64url');
    const tokenHash = this.hashToken(refreshToken);
    const family = randomBytes(16).toString('hex');

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash,
        family,
        expiresAt: new Date(Date.now() + REFRESH_TTL_SECONDS * 1000),
      },
    });

    await this.prisma.userSession.create({
      data: {
        userId: user.id,
        ip: meta.ip ?? null,
        userAgent: meta.userAgent?.slice(0, 400) ?? null,
      },
    });

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    return { accessToken, refreshToken, accessTokenExpiresIn: ACCESS_TTL_SECONDS };
  }

  async buildPrincipal(userId: string): Promise<RequestPrincipal & { isSuperAdmin: boolean }> {
    const assignments = await this.prisma.withReconnect((db) =>
      db.userRoleAssignment.findMany({
        where: {
          userId,
          OR: [{ validTo: null }, { validTo: { gt: new Date() } }],
        },
        include: { role: { include: { permissions: { include: { permission: true } } } } },
      }),
    );

    return { userId, email: '', ...resolveAccess(assignments) };
  }

  async rotateRefreshToken(presentedToken: string): Promise<{ userId: string; tokens: TokenPair }> {
    const tokenHash = this.hashToken(presentedToken);
    const stored = await this.prisma.withReconnect((db) =>
      db.refreshToken.findUnique({
        where: { tokenHash },
        include: { user: true },
      }),
    );

    if (!stored) {
      throw new AuthenticationError('Invalid refresh token');
    }

    if (stored.revokedAt) {
      // Token reuse detected — revoke the whole family (session compromise signal).
      await this.prisma.refreshToken.updateMany({
        where: { family: stored.family, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      this.logger.warn(`Refresh token reuse detected for user ${stored.userId}; family revoked`);
      throw new AuthenticationError('Session expired. Please sign in again.');
    }

    if (stored.expiresAt < new Date()) {
      throw new AuthenticationError('Session expired. Please sign in again.');
    }

    if (stored.user.status !== 'ACTIVE') {
      throw new AuthorizationError('Account is not active');
    }

    const user = { id: stored.user.id, email: stored.user.email };
    const tokens = await this.issueTokenPair(user, {});

    const newHash = this.hashToken(tokens.refreshToken);
    const created = await this.prisma.withReconnect((db) =>
      db.refreshToken.findUnique({ where: { tokenHash: newHash } }),
    );
    if (!created) throw new BusinessRuleError('Refresh token persistence failed');

    await this.prisma.$transaction([
      this.prisma.refreshToken.update({
        where: { id: stored.id },
        data: { revokedAt: new Date(), replacedById: created.id },
      }),
      this.prisma.refreshToken.update({
        where: { id: created.id },
        data: { family: stored.family },
      }),
    ]);

    return { userId: stored.userId, tokens };
  }

  async revokeAllSessions(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.prisma.withReconnect((db) =>
      db.user.findUnique({ where: { id: userId } }),
    );
    if (!user) throw new NotFoundError('User not found');
    const valid = await argon2.verify(user.passwordHash, currentPassword);
    if (!valid) {
      throw new AuthenticationError('Current password is incorrect');
    }
    const passwordHash = await argon2.hash(newPassword);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { passwordHash } });
      // Invalidate every existing session after a credential change.
      await tx.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.record(
        {
          actorUserId: userId,
          action: 'auth.password_changed',
          resourceType: 'user',
          resourceId: userId,
        },
        tx,
      );
    });
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  async getPrincipalForUser(userId: string): Promise<RequestPrincipal & { isSuperAdmin: boolean }> {
    const principal = await this.buildPrincipal(userId);
    const user = await this.prisma.withReconnect((db) =>
      db.user.findUnique({ where: { id: userId } }),
    );
    if (!user) throw new NotFoundError('User not found');
    principal.email = user.email;
    if (user.status !== 'ACTIVE') {
      throw new AuthorizationError('Account is not active');
    }
    return principal;
  }
}
