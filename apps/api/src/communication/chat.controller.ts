import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ChatService } from './chat.service.js';
import { RequirePermissions, PermissionsGuard } from '../iam/permissions.guard.js';
import { JwtAuthGuard } from '../iam/jwt-auth.guard.js';
import { getRequestId } from '../common/api-envelope.interceptor.js';
import type { Request } from 'express';
import type { RequestPrincipal } from '../common/request-context.js';
import {
  conversationCreateSchema,
  messageSendSchema,
  addParticipantSchema,
  uuidSchema,
} from '@erp/validation';

interface AuthedRequest extends Request {
  principal?: RequestPrincipal;
}

function requirePrincipal(req: AuthedRequest): RequestPrincipal {
  const principal = req.principal;
  if (!principal) {
    throw new Error('Authentication principal missing; auth guard misconfigured');
  }
  return principal;
}

function parsePagination(page?: string, pageSize?: string): { page: number; pageSize: number } {
  const p = Math.max(1, Number.parseInt(page ?? '1', 10) || 1);
  const ps = Math.min(200, Math.max(1, Number.parseInt(pageSize ?? '50', 10) || 50));
  return { page: p, pageSize: ps };
}

/**
 * Chat endpoints (PRD Stage 10). Class-level guards with per-route
 * RequirePermissions, matching the controller pattern of office/sales.
 */
@Controller('chat')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  // ---- Conversations ------------------------------------------------------

  @Post('conversations')
  @RequirePermissions('communication.chat.create')
  async createConversation(@Body() body: unknown, @Req() req: AuthedRequest) {
    const input = conversationCreateSchema.parse(body);
    return this.chat.createConversation(requirePrincipal(req), input, getRequestId(req));
  }

  @Get('conversations')
  @RequirePermissions('communication.chat.view')
  async listConversations(
    @Query('page') page: string | undefined,
    @Query('pageSize') pageSize: string | undefined,
    @Req() req: AuthedRequest,
  ) {
    return this.chat.listConversations(requirePrincipal(req), parsePagination(page, pageSize));
  }

  @Get('directory')
  @RequirePermissions('communication.chat.view')
  async listDirectory(
    @Query('companyId') companyId: string | undefined,
    @Query('search') search: string | undefined,
    @Req() req: AuthedRequest,
  ) {
    return this.chat.listDirectory(
      requirePrincipal(req),
      uuidSchema.parse(companyId),
      search?.trim() ? search.trim() : undefined,
    );
  }

  // ---- Messages -----------------------------------------------------------

  @Get('conversations/:id/messages')
  @RequirePermissions('communication.chat.view')
  async listMessages(
    @Param('id') id: string,
    @Query('page') page: string | undefined,
    @Query('pageSize') pageSize: string | undefined,
    @Req() req: AuthedRequest,
  ) {
    return this.chat.listMessages(requirePrincipal(req), id, parsePagination(page, pageSize));
  }

  @Post('conversations/:id/messages')
  @RequirePermissions('communication.chat.create')
  async sendMessage(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const input = messageSendSchema.parse(body);
    return this.chat.sendMessage(requirePrincipal(req), id, input, getRequestId(req));
  }

  // ---- Participants -------------------------------------------------------

  @Post('conversations/:id/participants')
  @RequirePermissions('communication.chat.edit')
  async addParticipant(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const input = addParticipantSchema.parse(body);
    return this.chat.addParticipant(requirePrincipal(req), id, input, getRequestId(req));
  }

  @Post('conversations/:id/read')
  @RequirePermissions('communication.chat.view')
  async markRead(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.chat.markRead(requirePrincipal(req), id, getRequestId(req));
  }
}
