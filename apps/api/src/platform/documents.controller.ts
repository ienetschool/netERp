import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
type MulterFile = { buffer: Buffer; originalname: string; mimetype: string; size: number };
import { z } from 'zod';
import { PrismaService } from '@erp/prisma';
import { JwtAuthGuard } from '../iam/jwt-auth.guard.js';
import { PermissionsGuard, RequirePermissions } from '../iam/permissions.guard.js';
import { StorageService } from './storage.service.js';
import { AuditService } from '../common/audit.service.js';
import { getRequestId } from '../common/api-envelope.interceptor.js';
import { AuthorizationError, NotFoundError, ValidationError } from '../common/errors.js';
import { canAccessCompany } from '../common/scope.util.js';
import type { RequestPrincipal } from '../common/request-context.js';

const ALLOWED_MIME_PREFIXES = ['image/', 'text/', 'application/pdf', 'application/json'];
const ALLOWED_EXTENSIONS = /\.(pdf|png|jpe?g|gif|webp|txt|csv|docx?|xlsx?|md|json)$/i;
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20 MB

const uploadMetaSchema = z.object({
  title: z.string().min(1).max(200),
  documentType: z.string().max(60).optional(),
  entityType: z.string().max(60).optional(),
  entityId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
  accessPolicy: z.enum(['COMPANY', 'BRANCH', 'PRIVATE']).optional(),
  description: z.string().max(1000).optional(),
});

const newVersionSchema = z.object({
  changeReason: z.string().max(300).optional(),
});

interface AuthedRequest extends Request {
  principal?: RequestPrincipal & { isSuperAdmin?: boolean };
}

@Controller('documents')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class DocumentsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  @Post()
  @RequirePermissions('documents.document.upload', 'office.document.upload')
  @UseInterceptors(AnyFilesInterceptor())
  async upload(
    @UploadedFile() file: MulterFile | undefined,
    @Body() body: Record<string, string>,
    @Req() req: AuthedRequest,
  ): Promise<unknown> {
    const principal = this.requirePrincipal(req);
    if (!file) {
      throw new ValidationError('No file provided');
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new ValidationError('File exceeds the 20 MB upload limit');
    }
    if (
      !ALLOWED_EXTENSIONS.test(file.originalname) &&
      !ALLOWED_MIME_PREFIXES.some((p) => file.mimetype.startsWith(p))
    ) {
      throw new ValidationError('File type is not allowed');
    }

    const meta = uploadMetaSchema.safeParse(body);
    if (!meta.success) {
      throw new ValidationError('Invalid document metadata', {
        issues: meta.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }

    // All seeded/demo companies are in scope for platform admins; otherwise the
    // uploaded document must belong to an accessible company. The first company
    // in scope is used when none is supplied (metadata validation still applies).
    let companyId: string | undefined;
    if (principal.companyIds === null) {
      const first = await this.prisma.company.findFirst({ orderBy: { code: 'asc' } });
      companyId = first?.id;
    } else {
      companyId = principal.companyIds[0];
    }
    if (!companyId) {
      throw new AuthorizationError('No company scope available for upload');
    }

    const stored = await this.storage.put(
      { companyId },
      file.originalname,
      file.buffer,
      file.mimetype,
    );

    const document = await this.prisma.$transaction(async (tx) => {
      const created = await tx.document.create({
        data: {
          companyId,
          branchId: meta.data.branchId ?? null,
          documentType: meta.data.documentType ?? null,
          title: meta.data.title,
          description: meta.data.description ?? null,
          storageKey: stored.storageKey,
          filename: file.originalname,
          mimeType: file.mimetype,
          sizeBytes: stored.sizeBytes,
          contentHash: stored.contentHash,
          accessPolicy: meta.data.accessPolicy ?? 'COMPANY',
          createdById: principal.userId,
        },
      });
      if (meta.data.entityType && meta.data.entityId) {
        await tx.documentLink.create({
          data: {
            documentId: created.id,
            entityType: meta.data.entityType,
            entityId: meta.data.entityId,
            relationshipType: 'ATTACHMENT',
          },
        });
      }
      await tx.documentVersion.create({
        data: {
          documentId: created.id,
          versionNo: 1,
          storageKey: stored.storageKey,
          contentHash: stored.contentHash,
          sizeBytes: stored.sizeBytes,
          uploadedById: principal.userId,
          changeReason: 'Initial upload',
        },
      });
      await this.audit.record(
        {
          actorUserId: principal.userId,
          action: 'document.uploaded',
          resourceType: 'document',
          resourceId: created.id,
          companyId,
          requestId: getRequestId(req),
          afterData: { filename: file.originalname, sizeBytes: stored.sizeBytes },
        },
        tx,
      );
      return created;
    });

    return {
      id: document.id,
      title: document.title,
      filename: document.filename,
      sizeBytes: document.sizeBytes.toString(),
      version: document.version,
    };
  }

  @Get()
  @RequirePermissions('documents.document.view', 'office.document.view')
  async list(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '25',
    @Req() req: AuthedRequest,
  ): Promise<unknown> {
    const principal = this.requirePrincipal(req);
    const p = this.parsePage(page, pageSize);
    const where = this.scopeWhere(principal);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.document.findMany({
        where,
        select: {
          id: true,
          title: true,
          description: true,
          documentType: true,
          filename: true,
          mimeType: true,
          sizeBytes: true,
          version: true,
          accessPolicy: true,
          createdAt: true,
          createdById: true,
        },
        orderBy: { createdAt: 'desc' },
        skip: p.skip,
        take: p.take,
      }),
      this.prisma.document.count({ where }),
    ]);
    return {
      data: items,
      meta: { page: p.page, pageSize: p.pageSize, total, requestId: getRequestId(req) },
    };
  }

  @Get(':id')
  @RequirePermissions('documents.document.view', 'office.document.view')
  async detail(@Param('id') id: string, @Req() req: AuthedRequest): Promise<unknown> {
    const principal = this.requirePrincipal(req);
    if (!this.isUuid(id)) throw new ValidationError('Invalid document id');
    const document = await this.prisma.document.findUnique({
      where: { id },
      include: { versions: { orderBy: { versionNo: 'desc' } }, links: true },
    });
    if (!document) throw new NotFoundError('Document not found');
    this.assertDocumentAccess(document, principal);
    await this.audit.record({
      actorUserId: principal.userId,
      action: 'document.viewed',
      resourceType: 'document',
      resourceId: document.id,
      companyId: document.companyId,
      requestId: getRequestId(req),
    });
    return {
      id: document.id,
      title: document.title,
      description: document.description,
      documentType: document.documentType,
      filename: document.filename,
      mimeType: document.mimeType,
      sizeBytes: document.sizeBytes.toString(),
      version: document.version,
      accessPolicy: document.accessPolicy,
      createdAt: document.createdAt,
      links: document.links,
      versions: document.versions.map((v) => ({
        id: v.id,
        versionNo: v.versionNo,
        sizeBytes: v.sizeBytes.toString(),
        uploadedAt: v.uploadedAt,
        changeReason: v.changeReason,
      })),
    };
  }

  @Get(':id/download')
  @RequirePermissions('documents.document.download', 'office.document.download')
  async download(
    @Param('id') id: string,
    @Req() req: AuthedRequest,
    @Res() res: Response,
  ): Promise<void> {
    const principal = this.requirePrincipal(req);
    if (!this.isUuid(id)) throw new ValidationError('Invalid document id');
    const document = await this.prisma.document.findUnique({ where: { id } });
    if (!document) throw new NotFoundError('Document not found');
    this.assertDocumentAccess(document, principal);

    const content = await this.storage.get(document.storageKey);
    await this.audit.record({
      actorUserId: principal.userId,
      action: 'document.downloaded',
      resourceType: 'document',
      resourceId: document.id,
      companyId: document.companyId,
      requestId: getRequestId(req),
    });

    res.setHeader('Content-Type', document.mimeType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(document.filename)}"`,
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(content);
  }

  @Post(':id/versions')
  @RequirePermissions('documents.document.upload', 'office.document.upload')
  @UseInterceptors(AnyFilesInterceptor())
  async addVersion(
    @Param('id') id: string,
    @UploadedFile() file: MulterFile | undefined,
    @Body() body: Record<string, string>,
    @Req() req: AuthedRequest,
  ): Promise<unknown> {
    const principal = this.requirePrincipal(req);
    if (!this.isUuid(id)) throw new ValidationError('Invalid document id');
    if (!file) throw new ValidationError('No file provided');
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new ValidationError('File exceeds the 20 MB upload limit');
    }
    const parsedReason = newVersionSchema.safeParse(body);
    const document = await this.prisma.document.findUnique({ where: { id } });
    if (!document) throw new NotFoundError('Document not found');
    this.assertDocumentAccess(document, principal);

    const stored = await this.storage.put(
      { companyId: document.companyId },
      file.originalname,
      file.buffer,
      file.mimetype,
    );
    const nextVersion = document.version + 1;

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.documentVersion.create({
        data: {
          documentId: document.id,
          versionNo: nextVersion,
          storageKey: stored.storageKey,
          contentHash: stored.contentHash,
          sizeBytes: stored.sizeBytes,
          uploadedById: principal.userId,
          changeReason: parsedReason.success ? (parsedReason.data.changeReason ?? null) : null,
        },
      });
      const updatedDoc = await tx.document.update({
        where: { id: document.id },
        data: {
          version: nextVersion,
          storageKey: stored.storageKey,
          contentHash: stored.contentHash,
          sizeBytes: stored.sizeBytes,
          filename: file.originalname || document.filename,
          mimeType: file.mimetype || document.mimeType,
        },
      });
      await this.audit.record(
        {
          actorUserId: principal.userId,
          action: 'document.version_added',
          resourceType: 'document',
          resourceId: document.id,
          companyId: document.companyId,
          requestId: getRequestId(req),
          afterData: { version: nextVersion, filename: file.originalname },
        },
        tx,
      );
      return updatedDoc;
    });

    return { id: updated.id, version: updated.version };
  }

  // ------------------------------------------------------------------
  private scopeWhere(principal: RequestPrincipal) {
    return principal.companyIds !== null ? { companyId: { in: principal.companyIds } } : {};
  }

  private assertDocumentAccess(
    document: { companyId: string; branchId: string | null; accessPolicy: string },
    principal: RequestPrincipal,
  ): void {
    if (!canAccessCompany(principal, document.companyId)) {
      throw new AuthorizationError('You do not have permission to access this document');
    }
    if (
      document.accessPolicy === 'BRANCH' &&
      document.branchId &&
      principal.branchIds !== null &&
      !principal.branchIds.includes(document.branchId)
    ) {
      throw new AuthorizationError('You do not have permission to access this document');
    }
  }

  private parsePage(page: string, pageSize: string) {
    const p = Math.max(1, Number.parseInt(page, 10) || 1);
    const ps = Math.min(200, Math.max(1, Number.parseInt(pageSize, 10) || 25));
    return { page: p, pageSize: ps, skip: (p - 1) * ps, take: ps };
  }

  private isUuid(value: string): boolean {
    return z.string().uuid().safeParse(value).success;
  }

  private requirePrincipal(req: AuthedRequest): RequestPrincipal & { isSuperAdmin?: boolean } {
    if (!req.principal) throw new AuthorizationError('Authentication required');
    return req.principal;
  }
}
