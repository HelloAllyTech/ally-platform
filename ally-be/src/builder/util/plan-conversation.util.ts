import type { BuilderMessage } from '../entity/builder-message.entity';
import { BuilderMessageRole } from '../enum/builder.enum';
import type { BuilderQuestionEvent } from '../type/builder-sse.type';

/**
 * Roadmap v2's one attributed session (plans/roadmap-builder-merge D13,
 * §4.5a, §5.7a): answers, comments and "Use this answer" choices posted on a
 * shared plan session by anyone with Roadmap access. Pure, so the
 * orchestrator (Builder) and the conversation service read the transcript the
 * same way. Lives in Builder because the orchestrator needs it and Builder
 * must not import the roadmap.
 */

export type PlanPostKind = 'answer' | 'comment' | 'settled';

/** Who posted, as the card and the agent show them: `[Ravi · author]`. */
export interface PlanPostAuthor {
  id: number;
  name: string;
  role: string;
  relation: 'author' | 'lead' | 'owner' | 'builder' | 'idea' | 'viewer';
}

/** `builder_messages.metadata.planPost` on a user row. */
export interface PlanPostMeta {
  kind: PlanPostKind;
  questionId?: string;
  optionIds?: string[];
  chosenPostId?: string;
  mentionUserIds?: number[];
  by: PlanPostAuthor;
}

/** `metadata.planBatch` on the lead's row: what the agent was handed with it. */
export interface PlanBatchMeta {
  text: string;
  postIds: string[];
}

export interface PlanPost {
  id: string;
  seq: number;
  kind: PlanPostKind;
  questionId?: string;
  text: string;
  optionIds?: string[];
  chosenPostId?: string;
  mentionUserIds?: number[];
  by: PlanPostAuthor;
  at: string;
  idempotencyKey: string;
}

export interface PlanQuestionState {
  questionId: string;
  prompt: string;
  options?: { id: string; label: string }[];
  /** Each person's latest answer, oldest first. */
  answers: PlanPost[];
  conflict: boolean;
  chosenPostId: string | null;
  settledBy: PlanPostAuthor | null;
  /** Every answer (and the choice) has reached the agent. */
  batched: boolean;
}

export const isPlanPost = (m: Pick<BuilderMessage, 'metadata'>): boolean =>
  !!m.metadata?.planPost;

export function planPostsOf(history: BuilderMessage[]): PlanPost[] {
  return history
    .filter((m) => m.role === BuilderMessageRole.USER && isPlanPost(m))
    .map((m) => {
      const meta = m.metadata!.planPost as PlanPostMeta;
      return {
        id: m.id,
        seq: m.seq,
        kind: meta.kind,
        ...(meta.questionId ? { questionId: meta.questionId } : {}),
        text: m.content ?? '',
        ...(meta.optionIds?.length ? { optionIds: meta.optionIds } : {}),
        ...(meta.chosenPostId ? { chosenPostId: meta.chosenPostId } : {}),
        ...(meta.mentionUserIds?.length
          ? { mentionUserIds: meta.mentionUserIds }
          : {}),
        by: meta.by,
        at: new Date(m.createdAt).toISOString(),
        idempotencyKey: String(m.metadata?.idempotencyKey ?? ''),
      };
    })
    .sort((a, b) => a.seq - b.seq);
}

/** Every question the agent asked in this session, by id (latest wins). */
export function questionsOf(
  history: BuilderMessage[],
): Map<string, BuilderQuestionEvent> {
  const out = new Map<string, BuilderQuestionEvent>();
  for (const m of history) {
    if (m.role !== BuilderMessageRole.ASSISTANT) continue;
    const questions = m.metadata?.questions;
    if (!Array.isArray(questions)) continue;
    for (const q of questions) {
      if (q && typeof q.id === 'string') out.set(q.id, q);
    }
  }
  return out;
}

/** Post ids the agent has already been handed. */
export function batchedPostIds(history: BuilderMessage[]): Set<string> {
  const ids = new Set<string>();
  for (const m of history) {
    const batch = m.metadata?.planBatch as PlanBatchMeta | undefined;
    for (const id of batch?.postIds ?? []) ids.add(id);
  }
  return ids;
}

/** Two answers say the same thing when their words and picks match, case and spacing aside. */
export function answerKey(post: Pick<PlanPost, 'text' | 'optionIds'>): string {
  const text = (post.text ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  const options = [...(post.optionIds ?? [])].sort().join(',');
  return `${options}|${text}`;
}

/**
 * Each question's answers, whether they conflict, and whether the settler
 * chose. Conflict (D13, §4.5a): two or more people's latest answers differ,
 * and no choice was made after the latest of them. Pure.
 */
export function questionStates(history: BuilderMessage[]): PlanQuestionState[] {
  const posts = planPostsOf(history);
  const questions = questionsOf(history);
  const batched = batchedPostIds(history);
  const ids = [
    ...new Set(
      posts
        .filter((p) => p.kind !== 'comment' && p.questionId)
        .map((p) => p.questionId as string),
    ),
  ];
  return ids.map((questionId) => {
    const latest = new Map<number, PlanPost>();
    for (const p of posts) {
      if (p.kind === 'answer' && p.questionId === questionId) {
        latest.set(p.by.id, p);
      }
    }
    const answers = [...latest.values()].sort((a, b) => a.seq - b.seq);
    const lastAnswerSeq = answers.reduce((max, a) => Math.max(max, a.seq), 0);
    const choice = [...posts]
      .reverse()
      .find(
        (p) =>
          p.kind === 'settled' &&
          p.questionId === questionId &&
          p.seq > lastAnswerSeq &&
          answers.some((a) => a.id === p.chosenPostId),
      );
    const distinct = new Set(answers.map(answerKey));
    const question = questions.get(questionId);
    const relevant = [
      ...answers.map((a) => a.id),
      ...(choice ? [choice.id] : []),
    ];
    return {
      questionId,
      prompt: question?.prompt ?? '',
      ...(question?.options?.length
        ? {
            options: question.options.map((o) => ({
              id: String(o.id),
              label: String(o.label),
            })),
          }
        : {}),
      answers,
      conflict: distinct.size > 1 && !choice,
      chosenPostId: choice?.chosenPostId ?? null,
      settledBy: choice?.by ?? null,
      batched: relevant.every((id) => batched.has(id)),
    };
  });
}

const label = (by: PlanPostAuthor) => `[${by.name} · ${by.relation}]`;
const clip = (text: string, max = 2000) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/**
 * What the next interview turn is handed (§4.5a): everything posted since
 * the agent last heard, attributed `[Name · role]`. Answers that conflict are
 * held back, words and all, until the settler chooses: the agent is told
 * they conflict and who is choosing, never what they say, so it cannot pick
 * between them. Comments are context, labelled as not answers. Null when
 * there is nothing new. Pure.
 */
export function renderPlanBatch(
  history: BuilderMessage[],
  settler: { name: string } | null,
): PlanBatchMeta | null {
  const batched = batchedPostIds(history);
  const posts = planPostsOf(history);
  const states = new Map(questionStates(history).map((s) => [s.questionId, s]));
  const lines: string[] = [];
  const postIds: string[] = [];
  const waiting: string[] = [];

  for (const state of states.values()) {
    if (state.batched) continue;
    const prompt = state.prompt
      ? `"${clip(state.prompt, 200)}"`
      : 'your question';
    if (state.conflict) {
      waiting.push(
        `- ${prompt}: ${state.answers.map((a) => label(a.by)).join(', ')} answered differently. ` +
          `${settler ? `${settler.name} is choosing` : 'Waiting for the settler to choose'}.`,
      );
      continue;
    }
    const chosen = state.chosenPostId
      ? state.answers.find((a) => a.id === state.chosenPostId)
      : null;
    if (chosen && state.settledBy) {
      lines.push(
        `- ${label(state.settledBy)} chose ${label(chosen.by)}'s answer to ${prompt}: ${clip(chosen.text)}`,
      );
    } else {
      for (const a of state.answers) {
        if (batched.has(a.id)) continue;
        lines.push(`- ${label(a.by)} answered ${prompt}: ${clip(a.text)}`);
      }
    }
    for (const a of state.answers) postIds.push(a.id);
    const choicePost = posts.find(
      (p) => p.kind === 'settled' && p.chosenPostId === state.chosenPostId,
    );
    if (choicePost) postIds.push(choicePost.id);
  }

  const comments = posts.filter(
    (p) => p.kind === 'comment' && !batched.has(p.id),
  );
  if (!lines.length && !waiting.length && !comments.length) return null;

  const parts: string[] = [
    'Since your last turn, people on this idea posted (each line names who and their part in the idea):',
  ];
  if (lines.length) parts.push(`Answers:\n${lines.join('\n')}`);
  if (waiting.length) {
    parts.push(
      `Answers that conflict, held until the settler chooses:\n${waiting.join('\n')}`,
    );
  }
  if (comments.length) {
    parts.push(
      `Comments between people (context only; not answers to your questions):\n${comments
        .map((c) => `- ${label(c.by)}: ${clip(c.text)}`)
        .join('\n')}`,
    );
    for (const c of comments) postIds.push(c.id);
  }
  return { text: parts.join('\n\n'), postIds: [...new Set(postIds)] };
}
