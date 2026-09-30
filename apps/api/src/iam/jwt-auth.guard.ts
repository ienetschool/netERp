import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { PrismaService } from '@erp/prisma';
import { AuthenticationError } from '../common/errors.js';
import { createRequestContext } from '../common/request-context.js';
import type { DecodedPrincipal } from './permissions.guard.js';

interface AccessTokenClaims {
  sub: string;
  email: string;
  sid: string;
  permissions: string[];
  companyIds: string[] | null;
  branchIds: string[] | null;
  departmentIds: string[] | null;
  warehouseIds: string[] | null;
  sa: boolean;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const ctx = createRequestContext(request);
    const header = request.headers['authorization'];
    const token =
      typeof header === 'string' && header.startsWith('Bearer ')
        ? header.slice('Bearer '.length)
        : undefined;

    if (!token) {
      throw new AuthenticationError('Missing bearer token');
    }

    let claims: AccessTokenClaims;
    try {
      const verified = await this.jwt.verifyAsync<Partial<AccessTokenClaims>>(token);
      claims = {
        sub: verified.sub ?? '',
        email: verified.email ?? '',
        sid: verified.sid ?? '',
        permissions: verified.permissions ?? [],
        companyIds: verified.companyIds ?? null,
        branchIds: verified.branchIds ?? null,
        departmentIds: verified.departmentIds ?? null,
        warehouseIds: verified.warehouseIds ?? null,
        sa: verified.sa === true,
      };
    } catch {
      throw new AuthenticationError('Invalid or expired token');
    }

    // Deny tokens for users who were disabled or locked after issuance.
    const user = await this.prisma.user.findUnique({ where: { id: claims.sub } });
    if (!user || user.status !== 'ACTIVE') {
      throw new AuthenticationError('Account is not active');
    }

    const principal: DecodedPrincipal = {
      userId: claims.sub,
      email: claims.email,
      permissions: claims.permissions,
      companyIds: claims.companyIds,
      branchIds: claims.branchIds,
      departmentIds: claims.departmentIds,
      warehouseIds: claims.warehouseIds,
      isSuperAdmin: claims.sa,
    };
    request.principal = principal;
    ctx.principal = principal;
    return true;
  }
}
