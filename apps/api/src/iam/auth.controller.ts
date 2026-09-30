import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { loginSchema } from '@erp/validation';
import { AuthService } from './auth.service.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { ValidationError } from '../common/errors.js';
import { AuditService } from '../common/audit.service.js';
import { getRequestId } from '../common/api-envelope.interceptor.js';
import type { Request } from 'express';
import type { RequestPrincipal } from '../common/request-context.js';

const refreshSchema = z.object({ refreshToken: z.string().min(16).max(2048) });

interface AuthedRequest extends Request {
  principal?: RequestPrincipal & { isSuperAdmin?: boolean };
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly audit: AuditService,
  ) {}

  /** Public: password login with lockout + audit. */
  @Post('login')
  async login(@Body() body: unknown, @Req() req: Request): Promise<unknown> {
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError('Invalid email or password format');
    }
    const { user } = await this.auth.validateLocalLogin(parsed.data.email, parsed.data.password);
    const tokens = await this.auth.issueTokenPair(user, {
      ip: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    });
    await this.audit.record({
      actorUserId: user.id,
      action: 'auth.login',
      resourceType: 'user',
      resourceId: user.id,
      requestId: getRequestId(req),
      ipAddress: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    });
    return tokens;
  }

  /** Public: refresh-token rotation with reuse detection. */
  @Post('refresh')
  async refresh(@Body() body: unknown): Promise<unknown> {
    const parsed = refreshSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError('Missing refresh token');
    }
    const { tokens } = await this.auth.rotateRefreshToken(parsed.data.refreshToken);
    return tokens;
  }

  /** Authenticated: revoke all refresh tokens for the calling user. */
  @Post('logout')
  @UseGuards(JwtAuthGuard)
  async logout(@Req() req: AuthedRequest): Promise<{ ok: true }> {
    if (req.principal) {
      await this.auth.revokeAllSessions(req.principal.userId);
      await this.audit.record({
        actorUserId: req.principal.userId,
        action: 'auth.logout',
        resourceType: 'user',
        resourceId: req.principal.userId,
        requestId: getRequestId(req),
      });
    }
    return { ok: true };
  }

  /** Authenticated: current principal + resolved scopes. */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@Req() req: AuthedRequest): unknown {
    const principal = req.principal;
    if (!principal) throw new ValidationError('Authentication required');
    return {
      userId: principal.userId,
      email: principal.email,
      permissions: principal.permissions,
      companyIds: principal.companyIds,
      branchIds: principal.branchIds,
      departmentIds: principal.departmentIds,
      warehouseIds: principal.warehouseIds,
      isSuperAdmin: principal.isSuperAdmin === true,
    };
  }

  /** Authenticated: change own password (invalidates other sessions). */
  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  async changePassword(@Body() body: unknown, @Req() req: AuthedRequest): Promise<{ ok: true }> {
    const principal = req.principal;
    if (!principal) throw new ValidationError('Authentication required');
    const parsed = z
      .object({
        currentPassword: z.string().min(8).max(200),
        newPassword: z.string().min(10).max(200),
      })
      .safeParse(body);
    if (!parsed.success) {
      throw new ValidationError('Invalid password payload');
    }
    await this.auth.changePassword(
      principal.userId,
      parsed.data.currentPassword,
      parsed.data.newPassword,
    );
    return { ok: true };
  }
}
