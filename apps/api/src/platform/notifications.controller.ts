import { Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../iam/jwt-auth.guard.js';
import { NotificationsService } from './notifications.service.js';
import { getRequestId } from '../common/api-envelope.interceptor.js';
import type { Request } from 'express';
import type { RequestPrincipal } from '../common/request-context.js';

interface AuthedRequest extends Request {
  principal?: RequestPrincipal;
}

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  async list(
    @Query('unread') unread: string | undefined,
    @Req() req: AuthedRequest,
  ): Promise<unknown> {
    const principal = req.principal;
    if (!principal) return [];
    const items = await this.notifications.listForUser(principal.userId, unread === 'true');
    return {
      data: items,
      meta: { requestId: getRequestId(req) },
    };
  }

  @Post(':id/read')
  async markRead(@Param('id') id: string, @Req() req: AuthedRequest): Promise<{ ok: true }> {
    const principal = req.principal;
    if (principal) {
      await this.notifications.markRead(principal.userId, id);
    }
    return { ok: true };
  }

  @Get('unread-count')
  async unreadCount(@Req() req: AuthedRequest): Promise<{ count: number }> {
    const principal = req.principal;
    if (!principal) return { count: 0 };
    const count = await this.notifications.unreadCount(principal.userId);
    return { count };
  }
}
