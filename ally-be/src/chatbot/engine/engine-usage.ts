import { randomUUID } from 'crypto';
import { usageContext, UsageContext } from 'src/billing/context/usage-context';
import { UsageChannel, UsageKind } from 'src/billing/enum/billing.enum';
import { agentRunIdFor } from './agent-runtime';
import { ChatTurn } from './chatbot-engine.types';

/**
 * The usage context for one message through the engine (CR1 Part A).
 *
 * The run id is the one the runner will send to ally-ai: derived from the provider message id
 * where there is one, so a redelivery meters nothing twice. Preview (Try it, checkups) has none,
 * so a fresh id is named here and the runner reuses it. A checkup sets `runKind: checkup` around
 * its Try it calls; that outer kind is kept.
 */
export function usageContextFor(turn: ChatTurn): UsageContext {
  const outer = usageContext.current();
  const type = turn.channel?.type;
  const channel =
    type === 'whatsapp'
      ? UsageChannel.WHATSAPP
      : type === 'web'
        ? // The bot page names the bubble around its call; the turn itself is the page's.
          outer?.channel === UsageChannel.BUBBLE
          ? UsageChannel.BUBBLE
          : UsageChannel.BOT_PAGE
        : type === 'test'
          ? UsageChannel.OWNER
          : UsageChannel.OTHER;
  const runKind =
    channel === UsageChannel.OWNER
      ? outer?.runKind === UsageKind.CHECKUP
        ? UsageKind.CHECKUP
        : UsageKind.TRY_IT
      : UsageKind.CUSTOMER_REPLY;
  return {
    runId: turn.providerMessageId
      ? agentRunIdFor(turn.providerMessageId)
      : randomUUID(),
    chatbotId: turn.chatbot?.id ?? null,
    creatorUserId: turn.chatbot?.createdBy ?? null,
    conversationId: turn.conversationId ?? null,
    draftId: outer?.draftId ?? null,
    channel,
    runKind,
    // Who is messaging, as the channel named it (a bot page names seats).
    ...(outer?.audience ? { audience: outer.audience } : {}),
    ...(outer?.seatEmail ? { seatEmail: outer.seatEmail } : {}),
    // Stage 9: Ally-paid work (the safety-pack release suite) stays Ally-paid through the turn.
    ...(outer?.allyPaidKind
      ? { allyPaidKind: outer.allyPaidKind, creatorUserId: null }
      : {}),
  };
}
