import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { PrismaService, Prisma } from '@erp/prisma';
import { PermissionSet } from '@erp/permissions';
import {
  createBranchSchema,
  createCompanySchema,
  createDepartmentSchema,
  createWarehouseSchema,
} from '@erp/validation';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { PermissionsGuard, RequirePermissions } from './permissions.guard.js';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../common/errors.js';
import { AuditService } from '../common/audit.service.js';
import { getRequestId } from '../common/api-envelope.interceptor.js';
import { canAccessCompany } from '../common/scope.util.js';
import type { Request } from 'express';
import type { RequestPrincipal } from '../common/request-context.js';
import { z } from 'zod';
import argon2 from 'argon2';

const createUserSchema = z.object({
  email: z.string().email().max(320),
  displayName: z.string().min(2).max(120),
  password: z.string().min(10).max(200),
  roleIds: z.array(z.string().uuid()).min(1).max(10),
  companyId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
});

const createRoleSchema = z.object({
  code: z
    .string()
    .min(2)
    .max(48)
    .regex(/^[A-Z0-9_]+$/, 'Role code must be UPPER_SNAKE_CASE'),
  name: z.string().min(2).max(120),
  description: z.string().max(400).optional(),
  permissionIds: z.array(z.string().uuid()).max(2000).optional(),
});

const assignRoleSchema = z.object({
  userId: z.string().uuid(),
  roleId: z.string().uuid(),
  companyId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
});

interface AuthedRequest extends Request {
  principal?: RequestPrincipal & { isSuperAdmin?: boolean };
}

function isUuid(value: string): boolean {
  return z.string().uuid().safeParse(value).success;
}

function parsePage(page: string | undefined, pageSize: string | undefined) {
  const p = Math.max(1, Number.parseInt(page ?? '1', 10) || 1);
  const ps = Math.min(200, Math.max(1, Number.parseInt(pageSize ?? '25', 10) || 25));
  return { page: p, pageSize: ps, skip: (p - 1) * ps, take: ps };
}

/**
 * The app-wide list envelope: the API client unwraps one `data` level, so rows
 * and the total both live inside it and `meta` carries only request context.
 */
function buildList<T>(
  items: T[],
  total: number,
  p: { page: number; pageSize: number },
  req: Request,
) {
  return {
    data: { rows: items, total },
    meta: { page: p.page, pageSize: p.pageSize, requestId: getRequestId(req) },
  };
}

function flattenZod(error: z.ZodError): Record<string, unknown> {
  return { issues: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) };
}

function mapPrismaConflict(e: unknown, message: string): unknown {
  if (
    typeof e === 'object' &&
    e !== null &&
    'code' in e &&
    (e as { code?: string }).code === 'P2002'
  ) {
    return new ConflictError(message);
  }
  return e instanceof Error ? e : new Error(String(e));
}

@Controller()
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------------
  // Users
  // ------------------------------------------------------------------

  @Get('users')
  @RequirePermissions('identity.user.view')
  async listUsers(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '25',
    @Req() req: AuthedRequest,
  ): Promise<unknown> {
    const p = parsePage(page, pageSize);
    const where: Prisma.UserWhereInput = {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          displayName: true,
          phone: true,
          status: true,
          mfaEnabled: true,
          lastLoginAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        skip: p.skip,
        take: p.take,
      }),
      this.prisma.user.count({ where }),
    ]);
    return buildList(items, total, p, req);
  }

  @Post('users')
  @RequirePermissions('identity.user.create', 'identity.user.edit')
  async createUser(@Body() body: unknown, @Req() req: AuthedRequest): Promise<unknown> {
    this.assertAdministrator(req);
    const parsed = createUserSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError('Invalid user payload', flattenZod(parsed.error));
    }
    const { email, displayName, password, roleIds, companyId, branchId } = parsed.data;
    const principal = this.requirePrincipal(req);

    const roles = await this.prisma.role.findMany({ where: { id: { in: roleIds } } });
    if (roles.length !== roleIds.length) {
      throw new ValidationError('One or more roles do not exist');
    }
    if (roles.some((r) => r.code === 'SUPER_ADMIN') && principal.isSuperAdmin !== true) {
      throw new AuthorizationError(
        'Only a Super Administrator can assign the Super Administrator role',
      );
    }

    const passwordHash = await argon2.hash(password);
    try {
      const user = await this.prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: { email: email.toLowerCase().trim(), displayName, passwordHash },
        });
        await tx.userRoleAssignment.createMany({
          data: roleIds.map((roleId) => ({
            userId: created.id,
            roleId,
            companyId: companyId ?? null,
            branchId: branchId ?? null,
          })),
        });
        await this.audit.record(
          {
            actorUserId: principal.userId,
            action: 'user.created',
            resourceType: 'user',
            resourceId: created.id,
            requestId: getRequestId(req),
            afterData: { email, displayName, roleIds, companyId, branchId },
          },
          tx,
        );
        return created;
      });
      return { id: user.id, email: user.email, displayName: user.displayName };
    } catch (e) {
      throw mapPrismaConflict(e, 'A user with this email already exists');
    }
  }

  @Post('users/assignments')
  @RequirePermissions('identity.user.edit')
  async assignRole(@Body() body: unknown, @Req() req: AuthedRequest): Promise<unknown> {
    this.assertAdministrator(req);
    const parsed = assignRoleSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError('Invalid assignment payload', flattenZod(parsed.error));
    }
    const { userId, roleId, companyId, branchId } = parsed.data;
    const principal = this.requirePrincipal(req);
    const [user, role] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId } }),
      this.prisma.role.findUnique({ where: { id: roleId } }),
    ]);
    if (!user) throw new NotFoundError('User not found');
    if (!role) throw new NotFoundError('Role not found');
    if (role.code === 'SUPER_ADMIN' && principal.isSuperAdmin !== true) {
      throw new AuthorizationError(
        'Only a Super Administrator can assign the Super Administrator role',
      );
    }
    const assignment = await this.prisma.$transaction(async (tx) => {
      const created = await tx.userRoleAssignment.create({
        data: { userId, roleId, companyId: companyId ?? null, branchId: branchId ?? null },
      });
      await this.audit.record(
        {
          actorUserId: principal.userId,
          action: 'user.role_assigned',
          resourceType: 'user_role_assignment',
          resourceId: created.id,
          requestId: getRequestId(req),
          afterData: { userId, roleId, companyId, branchId },
        },
        tx,
      );
      return created;
    });
    return { id: assignment.id };
  }

  // ------------------------------------------------------------------
  // Roles & permissions
  // ------------------------------------------------------------------

  @Get('roles')
  @RequirePermissions('identity.role.view')
  async listRoles(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '25',
    @Req() req: AuthedRequest,
  ): Promise<unknown> {
    const p = parsePage(page, pageSize);
    const where: Prisma.RoleWhereInput = {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.role.findMany({
        where,
        select: {
          id: true,
          code: true,
          name: true,
          description: true,
          isSystemRole: true,
          status: true,
          _count: { select: { users: true, permissions: true } },
        },
        orderBy: { code: 'asc' },
        skip: p.skip,
        take: p.take,
      }),
      this.prisma.role.count({ where }),
    ]);
    return buildList(items, total, p, req);
  }

  @Post('roles')
  @RequirePermissions('identity.role.create')
  async createRole(@Body() body: unknown, @Req() req: AuthedRequest): Promise<unknown> {
    this.assertAdministrator(req);
    const parsed = createRoleSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError('Invalid role payload', flattenZod(parsed.error));
    }
    const { code, name, description, permissionIds } = parsed.data;
    const principal = this.requirePrincipal(req);
    try {
      const role = await this.prisma.$transaction(async (tx) => {
        const created = await tx.role.create({
          data: { code, name, description, isSystemRole: false },
        });
        if (permissionIds && permissionIds.length > 0) {
          const count = await tx.permission.count({ where: { id: { in: permissionIds } } });
          if (count !== permissionIds.length) {
            throw new ValidationError('One or more permissions do not exist');
          }
          await tx.rolePermission.createMany({
            data: permissionIds.map((permissionId) => ({ roleId: created.id, permissionId })),
          });
        }
        await this.audit.record(
          {
            actorUserId: principal.userId,
            action: 'role.created',
            resourceType: 'role',
            resourceId: created.id,
            requestId: getRequestId(req),
            afterData: { code, name },
          },
          tx,
        );
        return created;
      });
      return { id: role.id, code: role.code, name: role.name };
    } catch (e) {
      throw mapPrismaConflict(e, 'A role with this code already exists');
    }
  }

  @Get('permissions')
  @RequirePermissions('identity.role.view')
  async listPermissions(@Query('search') search: string | undefined): Promise<unknown> {
    const where: Prisma.PermissionWhereInput = search
      ? {
          OR: [
            { module: { contains: search, mode: 'insensitive' } },
            { resource: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {};
    const permissions = await this.prisma.permission.findMany({
      where,
      orderBy: [{ module: 'asc' }, { resource: 'asc' }, { action: 'asc' }],
      take: 500,
    });
    return permissions.map((p) => ({ id: p.id, key: `${p.module}.${p.resource}.${p.action}` }));
  }

  // ------------------------------------------------------------------
  // Organization structure
  // ------------------------------------------------------------------

  @Get('companies')
  @RequirePermissions('organization.company.view')
  async listCompanies(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '25',
    @Req() req: AuthedRequest,
  ): Promise<unknown> {
    const principal = this.requirePrincipal(req);
    const p = parsePage(page, pageSize);
    const where: Prisma.CompanyWhereInput =
      principal.companyIds !== null ? { id: { in: principal.companyIds } } : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.company.findMany({
        where,
        orderBy: { code: 'asc' },
        skip: p.skip,
        take: p.take,
      }),
      this.prisma.company.count({ where }),
    ]);
    return buildList(items, total, p, req);
  }

  @Post('companies')
  @RequirePermissions('organization.company.create')
  async createCompany(@Body() body: unknown, @Req() req: AuthedRequest): Promise<unknown> {
    this.assertAdministrator(req);
    const parsed = createCompanySchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError('Invalid company payload', flattenZod(parsed.error));
    }
    const principal = this.requirePrincipal(req);
    try {
      const company = await this.prisma.$transaction(async (tx) => {
        const created = await tx.company.create({ data: parsed.data });
        await this.audit.record(
          {
            actorUserId: principal.userId,
            action: 'company.created',
            resourceType: 'company',
            resourceId: created.id,
            requestId: getRequestId(req),
            afterData: { code: created.code, name: created.name },
          },
          tx,
        );
        return created;
      });
      return { id: company.id, code: company.code, name: company.name };
    } catch (e) {
      throw mapPrismaConflict(e, 'A company with this code already exists');
    }
  }

  @Get('branches')
  @RequirePermissions('organization.branch.view')
  async listBranches(
    @Query('companyId') companyId: string | undefined,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '25',
    @Req() req: AuthedRequest,
  ): Promise<unknown> {
    const principal = this.requirePrincipal(req);
    const p = parsePage(page, pageSize);
    const where: Prisma.BranchWhereInput = {};
    if (companyId) {
      if (!isUuid(companyId)) throw new ValidationError('companyId must be a UUID');
      if (!canAccessCompany(principal, companyId)) {
        throw new AuthorizationError('You do not have access to this company');
      }
      where.companyId = companyId;
    } else if (principal.companyIds !== null) {
      where.companyId = { in: principal.companyIds };
    }
    const [items, total] = await this.prisma.$transaction([
      this.prisma.branch.findMany({
        where,
        orderBy: [{ companyId: 'asc' }, { code: 'asc' }],
        skip: p.skip,
        take: p.take,
      }),
      this.prisma.branch.count({ where }),
    ]);
    return buildList(items, total, p, req);
  }

  @Post('branches')
  @RequirePermissions('organization.branch.create')
  async createBranch(@Body() body: unknown, @Req() req: AuthedRequest): Promise<unknown> {
    this.assertAdministrator(req);
    const parsed = createBranchSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError('Invalid branch payload', flattenZod(parsed.error));
    }
    const principal = this.requirePrincipal(req);
    if (!canAccessCompany(principal, parsed.data.companyId)) {
      throw new AuthorizationError('You cannot create branches for another company');
    }
    try {
      const branch = await this.prisma.$transaction(async (tx) => {
        const created = await tx.branch.create({ data: parsed.data });
        await this.audit.record(
          {
            actorUserId: principal.userId,
            action: 'branch.created',
            resourceType: 'branch',
            resourceId: created.id,
            companyId: created.companyId,
            requestId: getRequestId(req),
            afterData: { code: created.code, name: created.name },
          },
          tx,
        );
        return created;
      });
      return { id: branch.id, code: branch.code, name: branch.name };
    } catch (e) {
      throw mapPrismaConflict(e, 'A branch with this code already exists in the company');
    }
  }

  @Get('departments')
  @RequirePermissions('organization.department.view')
  async listDepartments(
    @Query('companyId') companyId: string | undefined,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '25',
    @Req() req: AuthedRequest,
  ): Promise<unknown> {
    const principal = this.requirePrincipal(req);
    const p = parsePage(page, pageSize);
    const where: Prisma.DepartmentWhereInput = {};
    if (companyId) {
      if (!isUuid(companyId)) throw new ValidationError('companyId must be a UUID');
      if (!canAccessCompany(principal, companyId)) {
        throw new AuthorizationError('You do not have access to this company');
      }
      where.companyId = companyId;
    } else if (principal.companyIds !== null) {
      where.companyId = { in: principal.companyIds };
    }
    const [items, total] = await this.prisma.$transaction([
      this.prisma.department.findMany({
        where,
        orderBy: { code: 'asc' },
        skip: p.skip,
        take: p.take,
      }),
      this.prisma.department.count({ where }),
    ]);
    return buildList(items, total, p, req);
  }

  @Post('departments')
  @RequirePermissions('organization.department.create')
  async createDepartment(@Body() body: unknown, @Req() req: AuthedRequest): Promise<unknown> {
    this.assertAdministrator(req);
    const parsed = createDepartmentSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError('Invalid department payload', flattenZod(parsed.error));
    }
    const principal = this.requirePrincipal(req);
    if (!canAccessCompany(principal, parsed.data.companyId)) {
      throw new AuthorizationError('You cannot create departments for another company');
    }
    const department = await this.prisma.$transaction(async (tx) => {
      const created = await tx.department.create({ data: parsed.data });
      await this.audit.record(
        {
          actorUserId: principal.userId,
          action: 'department.created',
          resourceType: 'department',
          resourceId: created.id,
          companyId: created.companyId,
          branchId: created.branchId,
          requestId: getRequestId(req),
        },
        tx,
      );
      return created;
    });
    return { id: department.id, code: department.code, name: department.name };
  }

  @Get('warehouses')
  @RequirePermissions('organization.warehouse.view')
  async listWarehouses(
    @Query('companyId') companyId: string | undefined,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '25',
    @Req() req: AuthedRequest,
  ): Promise<unknown> {
    const principal = this.requirePrincipal(req);
    const p = parsePage(page, pageSize);
    const where: Prisma.WarehouseWhereInput = {};
    if (companyId) {
      if (!isUuid(companyId)) {
        throw new ValidationError('companyId must be a UUID');
      }
      if (!canAccessCompany(principal, companyId)) {
        throw new AuthorizationError('You do not have access to this company');
      }
      where.companyId = companyId;
    } else if (principal.companyIds !== null) {
      where.companyId = { in: principal.companyIds };
    }
    const [items, total] = await this.prisma.$transaction([
      this.prisma.warehouse.findMany({
        where,
        orderBy: { code: 'asc' },
        skip: p.skip,
        take: p.take,
      }),
      this.prisma.warehouse.count({ where }),
    ]);
    return buildList(items, total, p, req);
  }

  @Post('warehouses')
  @RequirePermissions('organization.warehouse.create')
  async createWarehouse(@Body() body: unknown, @Req() req: AuthedRequest): Promise<unknown> {
    this.assertAdministrator(req);
    const parsed = createWarehouseSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError('Invalid warehouse payload', flattenZod(parsed.error));
    }
    const principal = this.requirePrincipal(req);
    if (!canAccessCompany(principal, parsed.data.companyId)) {
      throw new AuthorizationError('You cannot create warehouses for another company');
    }
    const warehouse = await this.prisma.$transaction(async (tx) => {
      const created = await tx.warehouse.create({ data: parsed.data });
      await this.audit.record(
        {
          actorUserId: principal.userId,
          action: 'warehouse.created',
          resourceType: 'warehouse',
          resourceId: created.id,
          companyId: created.companyId,
          branchId: created.branchId,
          requestId: getRequestId(req),
        },
        tx,
      );
      return created;
    });
    return { id: warehouse.id, code: warehouse.code, name: warehouse.name };
  }

  // ------------------------------------------------------------------
  // helpers
  // ------------------------------------------------------------------

  private requirePrincipal(req: AuthedRequest): RequestPrincipal & { isSuperAdmin?: boolean } {
    if (!req.principal) throw new AuthorizationError('Authentication required');
    return req.principal;
  }

  private assertAdministrator(req: AuthedRequest): void {
    const principal = this.requirePrincipal(req);
    const set = new PermissionSet(principal.permissions);
    const allowed =
      principal.isSuperAdmin === true ||
      set.has('identity.user.create') ||
      set.has('identity.user.edit');
    if (!allowed) {
      throw new AuthorizationError('Administrative privileges required');
    }
  }
}
