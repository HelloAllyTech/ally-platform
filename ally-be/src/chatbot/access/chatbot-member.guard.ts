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

/** Enforces `@ChatbotRole`: only the bot's members, at the declared role or above. */
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
    await this.access.assert(chatbotId, options.role, userId);
    return true;
  }
}
