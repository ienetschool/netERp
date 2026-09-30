import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { PrismaModule } from './prisma.module.js';
import { ApiEnvelopeInterceptor } from './common/api-envelope.interceptor.js';
import { GlobalExceptionFilter } from './common/global-exception.filter.js';
import { AuditService } from './common/audit.service.js';
import { AuthController } from './iam/auth.controller.js';
import { AdminController } from './iam/admin.controller.js';
import { AuthService } from './iam/auth.service.js';
import { NumberingService } from './platform/numbering.service.js';
import { StorageService } from './platform/storage.service.js';
import { NotificationsService } from './platform/notifications.service.js';
import { OutboxService } from './platform/outbox.service.js';
import { DocumentsController } from './platform/documents.controller.js';
import { NotificationsController } from './platform/notifications.controller.js';
import { SearchController } from './platform/search.controller.js';
import { HealthController } from './platform/health.controller.js';
import { DashboardController } from './platform/dashboard.controller.js';
import { AuditController } from './platform/audit.controller.js';
import { WorkflowController } from './workflow/workflow.controller.js';
import { WorkflowEngineService } from './workflow/workflow-engine.service.js';
import { SettingsController } from './settings/settings.controller.js';
import { SettingsService } from './settings/settings.service.js';
import { JwtModule } from '@nestjs/jwt';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env'] }),
    PrismaModule,
    JwtModule.register({
      secret: process.env.JWT_ACCESS_SECRET,
      signOptions: { expiresIn: Number(process.env.JWT_ACCESS_TTL_SECONDS ?? 900) },
    }),
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60_000,
        limit: 120,
      },
    ]),
    ThrottlerModule.forRoot([
      {
        name: 'auth',
        ttl: 60_000,
        limit: 10,
      },
    ]),
  ],
  controllers: [
    AuthController,
    AdminController,
    DocumentsController,
    NotificationsController,
    SearchController,
    HealthController,
    DashboardController,
    AuditController,
    WorkflowController,
    SettingsController,
  ],
  providers: [
    AuthService,
    AuditService,
    NumberingService,
    StorageService,
    NotificationsService,
    OutboxService,
    WorkflowEngineService,
    SettingsService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: ApiEnvelopeInterceptor },
  ],
})
export class AppModule {}
