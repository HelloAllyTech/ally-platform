import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';

// The keys `@ChatbotRole` and `@AssistantScope` set (src/chatbot/access/chatbot-role.decorator.ts).
// Written out here so the auth guards don't import the chatbot module.
const CHATBOT_ROLE_KEY = 'chatbot:role';
const ASSISTANT_SCOPE_KEY = 'chatbot:assistant-scope';

/**
 * A route a person may use because they're on an assistant's team, with no feature toggle and no
 * role permission (chunk 6b, item 31: "being on a team is enough"):
 * - a route naming one assistant (`@ChatbotRole`): `ChatbotMemberGuard`, which runs after the
 *   permission and toggle guards, still refuses anyone who isn't on that assistant's team at the
 *   route's role (404 to a non-member, platform admins included);
 * - a route listing the caller's own assistants (`@AssistantScope('list')`): filtered to their
 *   teams, so a person on none gets an empty list.
 * Creating an assistant (`create`), and `service` and `platform` routes, keep their toggle.
 */
export function isAssistantMemberRoute(
  reflector: Reflector,
  context: ExecutionContext,
): boolean {
  const targets = [context.getHandler(), context.getClass()];
  const role = reflector.getAllAndOverride<unknown>(CHATBOT_ROLE_KEY, targets);
  if (
    role &&
    typeof role === 'object' &&
    (typeof (role as { role?: unknown }).role === 'string' ||
      typeof (role as { capability?: unknown }).capability === 'string') &&
    typeof (role as { param?: unknown }).param === 'string'
  ) {
    return true;
  }
  return reflector.getAllAndOverride(ASSISTANT_SCOPE_KEY, targets) === 'list';
}
