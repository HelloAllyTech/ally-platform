import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { ChatbotCapability, ChatbotMemberRole } from '../enum/chatbot.enum';
import { ChatbotMemberGuard } from './chatbot-member.guard';
import { capabilityForLegacyRole } from './chatbot-roles';

export const CHATBOT_ROLE_KEY = 'chatbot:role';
export const ASSISTANT_SCOPE_KEY = 'chatbot:assistant-scope';

export interface ChatbotRoleOptions {
  /** The OLD ladder role the route was declared with; absent on a `@ChatbotCan` route. */
  role?: ChatbotMemberRole;
  /** What the guard checks (Stage 1b). `@ChatbotRole(min)` stores the capability `min` meant. */
  capability: ChatbotCapability;
  /** The route param naming the bot (`:id` on `v1/chatbots/:id/…`, `:chatbotId` in the Inbox). */
  param: string;
}

/**
 * The least role on the bot named by the route's `:id` (or `param`) that this route needs (A1).
 *
 * The guard runs after the route's own guards (put this decorator above `@RequireFeatureToggle`)
 * and answers like `ChatbotAccessService.assert`: 404 to anyone who is not on the bot, platform
 * admins included, and 403 to a member below `role`. Services keep their own `assert` calls: this
 * is the floor every route declares, so the route walk can prove none is missing.
 */
export function ChatbotRole(role: ChatbotMemberRole, param = 'id') {
  return applyDecorators(
    SetMetadata(CHATBOT_ROLE_KEY, {
      role,
      capability: capabilityForLegacyRole(role),
      param,
    } as ChatbotRoleOptions),
    UseGuards(ChatbotMemberGuard),
  );
}

/**
 * Stage 1b: the capability on the bot named by the route's `:id` (or `param`) that this route
 * needs. Same guard and answers as `@ChatbotRole` (404 to non-members, 403 without it).
 */
export function ChatbotCan(capability: ChatbotCapability, param = 'id') {
  return applyDecorators(
    SetMetadata(CHATBOT_ROLE_KEY, { capability, param } as ChatbotRoleOptions),
    UseGuards(ChatbotMemberGuard),
  );
}

/**
 * How an assistant route with no bot in its path is kept to the caller's own bots:
 * - `list`: it lists or counts, filtered to the bots the caller is a member of;
 * - `create`: it creates a bot (the caller becomes its owner);
 * - `service`: the bot comes from the body, query or a row (draft, conversation, connector,
 *   number) and the service checks the caller's role on it;
 * - `platform`: it acts on something that belongs to no bot, for platform admins only.
 */
export type AssistantScopeKind = 'list' | 'create' | 'service' | 'platform';

export const AssistantScope = (kind: AssistantScopeKind) =>
  SetMetadata(ASSISTANT_SCOPE_KEY, kind);
