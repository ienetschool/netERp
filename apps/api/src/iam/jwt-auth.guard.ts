import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { PrismaService } from '@erp/prisma';
import { AuthenticationError } from '../common/errors.js';
import { createRequestContext } from '../common/request-context.js';
import type { DecodedPrincipal } from './permissions.guard.js';
import { resolveAccess } from './principal.js';

/**
 * The token carries identity only (sub/email/sid). Permissions and scope are
 * resolved from the database on every request: a full permission set is ~30 KB,
 * and a token that big is rejected by HTTP stacks with 431 before it reaches
 * application code. The assignments ride along on the account-status lookup the
 * guard already performed, so this costs no extra query — and it makes role
 * changes take effect immediately instead of at token expiry.
 */
interface AccessTokenClaims {
  sub: string;
  email: string;
  sid: string;
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
      };
    } catch {
      throw new AuthenticationError('Invalid or expired token');
    }

    // Deny tokens for users who were disabled or locked after issuance, and pick
    // up their current role assignments in the same round trip. The lookup runs
    // on every request, so it goes through the reconnecting helper: a pooled
    // socket dropped by the server must not turn into a failed sign-in.
    const user = await this.prisma.withReconnect((db) =>
      db.user.findUnique({
        where: { id: claims.sub },
        include: {
          roles: {
            where: { OR: [{ validTo: null }, { validTo: { gt: new Date() } }] },
            include: { role: { include: { permissions: { include: { permission: true } } } } },
          },
        },
      }),
    );
    if (!user || user.status !== 'ACTIVE') {
      throw new AuthenticationError('Account is not active');
    }

    const access = resolveAccess(user.roles);
    const principal: DecodedPrincipal = {
      userId: user.id,
      email: user.email,
      permissions: access.permissions,
      companyIds: access.companyIds,
      branchIds: access.branchIds,
      departmentIds: access.departmentIds,
      warehouseIds: access.warehouseIds,
      isSuperAdmin: access.isSuperAdmin,
    };
    request.principal = principal;
    ctx.principal = principal;
    return true;
  }
}
