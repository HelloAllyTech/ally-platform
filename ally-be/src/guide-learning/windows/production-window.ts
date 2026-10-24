import { reviewableText } from 'src/guide/safety/redaction';
import {
  EvalWindow,
  QuizKey,
  WindowMessage,
} from '../checks/deterministic-checks';
import { SituationFacts } from '../checks/situation';
import { WINDOW_CONTEXT_MESSAGES } from '../constants/guide-learning.constants';

/**
 * One production window — an Ally turn and the messages before it — as the
 * evaluator, the review queue and "Save as eval case" read it. Assembled from
 * rows; pure.
 *
 * Two copies of the text: `window` holds the stored words, for the
 * deterministic checks (which run in memory and store no text), and
 * `reviewable` holds what a person or a judge may read — contact details
 * masked, and a message flagged as naming a real person hidden whole
 * (src/guide/safety/redaction.ts).
 */

export interface TurnRow {
  id: string;
  threadId: string;
  releaseId: string | null;
  arm: string | null;
  channel: string;
  status: string;
  trigger: string;
  tenantId: string | null;
  trackId: string | null;
  userId: number | null;
  summary: Record<string, any> | null;
}

export interface MessageRow {
  id: string;
  threadId: string;
  seq: number;
  role: string;
  kind: string;
  content: string | null;
  redactedContent: string | null;
  flags: Record<string, boolean> | null;
  turnId: string | null;
}

export interface ReviewableWindow {
  recent: WindowMessage[];
  learnerText: string | null;
  reply: { text: string; kind: string };
}

export interface ProductionWindow {
  turn: TurnRow;
  replyMessageId: string | null;
  learnerMessageId: string | null;
  window: EvalWindow;
  reviewable: ReviewableWindow;
  /** Learner message flagged as naming a real person or identifying details. */
  learnerFlagged: boolean;
  flags: string[];
  safety: boolean;
  /** What the situation report said, once the trace payload is read. */
  situation?: SituationFacts | null;
}

export interface WindowContext {
  quizKeys: QuizKey[];
  approvedCrisisTexts: string[];
  praiseEveryTurns: number;
}

const asRole = (role: string): 'learner' | 'ally' =>
  role === 'learner' ? 'learner' : 'ally';

/** Why a turn is flagged, from its trace summary, status and thumbs. */
export function summaryFlags(
  turn: Pick<TurnRow, 'status' | 'summary'>,
  thumbsDown: boolean,
): { flags: string[]; safety: boolean } {
  const s = turn.summary ?? {};
  const flags: string[] = [];
  let safety = false;
  const sentinel = s.sentinel ?? null;
  if (sentinel?.risk === 'crisis') {
    flags.push('sentinel_crisis');
    safety = true;
  } else if (sentinel?.risk === 'care') {
    flags.push('sentinel_care');
  }
  if (sentinel?.overlay && sentinel.overlay !== 'none') {
    flags.push(`overlay_${sentinel.overlay}`);
    safety = true;
  }
  if (s.replyKind === 'crisis' || s.replyKind === 'urgent_real_case') {
    flags.push(`reply_${s.replyKind}`);
    safety = true;
  }
  if (s.replyKind === 'refusal') flags.push('refusal');
  if (s.modeAfter && s.modeAfter !== s.modeBefore && s.modeAfter !== 'NORMAL') {
    flags.push(`mode_${String(s.modeAfter).toLowerCase()}`);
  }
  if (turn.status === 'failed') flags.push('failed');
  if (thumbsDown) flags.push('thumbs_down');
  return { flags, safety };
}

/**
 * The window for one turn from its thread's messages (any order). The reply
 * is the turn's Ally message the trace names, else its last Ally message.
 */
export function assembleWindow(
  turn: TurnRow,
  threadMessages: MessageRow[],
  ctx: WindowContext,
  situation: SituationFacts | null = null,
  toolCalls: EvalWindow['toolCalls'] = [],
): Omit<ProductionWindow, 'flags' | 'safety'> | null {
  const messages = threadMessages
    .filter(
      (m) =>
        m.threadId === turn.threadId &&
        (m.role === 'learner' || m.role === 'ally'),
    )
    .sort((a, b) => a.seq - b.seq);
  const ofTurn = messages.filter((m) => m.turnId === turn.id);
  const named = turn.summary?.replyMessageId as string | undefined;
  const reply =
    (named && ofTurn.find((m) => m.id === named)) ||
    [...ofTurn].reverse().find((m) => m.role === 'ally') ||
    null;
  if (!reply) return null;
  const learner = ofTurn.find((m) => m.role === 'learner') ?? null;
  const before = messages
    .filter((m) => m.seq < (learner?.seq ?? reply.seq))
    .slice(-WINDOW_CONTEXT_MESSAGES);
  const replyKind = String(turn.summary?.replyKind ?? 'model');
  const sentinel = turn.summary?.sentinel ?? null;
  const channel =
    situation?.channel ?? (turn.channel === 'voice' ? 'voice' : 'text');
  const learnerFlagged = Boolean(
    learner?.flags?.pii || learner?.flags?.realCase,
  );

  const window: EvalWindow = {
    reply: { text: reply.content ?? '', kind: replyKind },
    channel,
    learnerText: learner?.content ?? null,
    recent: before.map((m) => ({
      role: asRole(m.role),
      text: m.content ?? '',
    })),
    mode: (turn.summary?.modeAfter as string) ?? situation?.mode ?? null,
    sentinel: sentinel
      ? {
          risk: String(sentinel.risk),
          about: String(sentinel.about),
          overlay: sentinel.overlay ? String(sentinel.overlay) : undefined,
        }
      : null,
    budget: situation?.budget ?? null,
    releaseWindowOpen: situation?.releaseWindowOpen ?? false,
    toolCalls: toolCalls.length
      ? toolCalls
      : (
          (turn.summary?.tools as Array<{ name: string }> | undefined) ?? []
        ).map((tool) => ({ name: tool.name, input: null })),
    quizKeys: ctx.quizKeys,
    approvedCrisisTexts: ctx.approvedCrisisTexts,
    praiseEveryTurns: ctx.praiseEveryTurns,
  };
  const reviewable: ReviewableWindow = {
    recent: before.map((m) => ({
      role: asRole(m.role),
      text: reviewableText(m) ?? '',
    })),
    learnerText: learner ? reviewableText(learner) : null,
    reply: { text: reviewableText(reply) ?? '', kind: replyKind },
  };
  return {
    turn,
    replyMessageId: reply.id,
    learnerMessageId: learner?.id ?? null,
    window,
    reviewable,
    learnerFlagged,
  };
}
