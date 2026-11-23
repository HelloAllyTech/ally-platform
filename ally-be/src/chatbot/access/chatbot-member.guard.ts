import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { ChatbotAccessService } from '../service/chatbot-access.service';
import type { ChatbotRoleOptions } from './chatbot-role.decorator';

// Not imported from the decorator file, which imports this one.
const CHATBOT_ROLE_KEY = 'chatbot:role';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Enforces `@ChatbotRole` / `@ChatbotCan`: only the bot's members holding the capability. */
@Injectable()
export class ChatbotMemberGuard implements CanActivate {
  // Authenticates on its own when it happens to run before the route's JWT guard.
  private readonly jwt = new (AuthGuard('jwt'))();

  constructor(
    private readonly reflector: Reflector,
    private readonly access: ChatbotAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride<
      ChatbotRoleOptions | undefined
    >(CHATBOT_ROLE_KEY, [context.getHandler(), context.getClass()]);
    if (!options) return true;

    const request = context.switchToHttp().getRequest();
    if (!request.user) await this.jwt.canActivate(context);
    const userId = Number(request.user?.id ?? 0);
    if (!userId) throw new UnauthorizedException();

    const chatbotId = String(request.params?.[options.param] ?? '');
    if (!UUID.test(chatbotId)) throw new NotFoundException('Chatbot not found');
    // Stage 8: a VIEW route may also admit Ally staff read-only, per the staff access matrix and
    // only after the read is logged (see `assertCanOnRoute`).
    await this.access.assertCanOnRoute(
      chatbotId,
      options.capability,
      userId,
      staffRouteOf(context, request),
    );
    return true;
  }
}

type GuardRequest = {
  method?: string;
  route?: { path?: string };
  path?: string;
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
};

/** What the staff view log records about this request (ids only, never content). */
export function staffRouteOf(context: ExecutionContext, request: GuardRequest) {
  const key = `${context.getClass().name}.${context.getHandler().name}`;
  const params = request.params ?? {};
  const uuid = (v: unknown) =>
    typeof v === 'string' && UUID.test(v) ? v : null;
  const conversationId =
    key === 'InboxController.thread'
      ? uuid(params.id)
      : uuid(request.query?.conversationId);
  const targetParam = ['contactId', 'recordId', 'runId', 'documentId'].find(
    (p) => params[p] !== undefined,
  );
  return {
    key,
    route: `${request.method ?? 'GET'} ${request.route?.path ?? request.path ?? ''}`,
    params,
    conversationId,
    target: targetParam
      ? `${targetParam}:${String(params[targetParam])}`
      : null,
  };
}
