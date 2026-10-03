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
import { HrController } from './hr/hr.controller.js';
import { HrService } from './hr/hr.service.js';
import { PayrollController } from './payroll/payroll.controller.js';
import { PayrollService } from './payroll/payroll.service.js';
import { ProcurementController } from './procurement/procurement.controller.js';
import { ProcurementService } from './procurement/procurement.service.js';
import { InventoryController } from './inventory/inventory.controller.js';
import { InventoryService } from './inventory/inventory.service.js';
import { SalesController } from './sales/sales.controller.js';
import { SalesService } from './sales/sales.service.js';
import { AccountingController } from './accounting/accounting.controller.js';
import { AccountingService } from './accounting/accounting.service.js';
import { OfficeController } from './office/office.controller.js';
import { OfficeService } from './office/office.service.js';
import { ChatController } from './communication/chat.controller.js';
import { ChatService } from './communication/chat.service.js';
import { ReportingController } from './reporting/reporting.controller.js';
import { ReportingService } from './reporting/reporting.service.js';
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
    HrController,
    PayrollController,
    ProcurementController,
    InventoryController,
    SalesController,
    AccountingController,
    OfficeController,
    ChatController,
    ReportingController,
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
    HrService,
    PayrollService,
    ProcurementService,
    InventoryService,
    SalesService,
    AccountingService,
    OfficeService,
    ChatService,
    ReportingService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: ApiEnvelopeInterceptor },
  ],
})
export class AppModule {}
