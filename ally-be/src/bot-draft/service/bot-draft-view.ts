import { BotDraftEntity } from '../entity/bot-draft.entity';
import { packFor } from '../safety-pack/safety-packs';
import type { DraftEvent } from '../type/bot-draft.type';
import { conversation, designCards } from './bot-draft-session.service';

/** Changes listed for undo: the latest first. */
const CHANGES_SHOWN = 30;

/**
 * A draft as the dashboard reads it: everything the canvas and the chat need to redraw, and
 * nothing it doesn't (the crawl's queue, the full event log with inverse patches).
 */
export function draftView(draft: BotDraftEntity) {
  const pack = packFor(draft.draftConfig.safetyPackId);
  const state = conversation(draft);
  const crawl = draft.crawl ?? {
    status: 'idle',
    queue: [],
    seen: [],
    pages: [],
    findings: [],
  };
  const asked = [
    ...(state.gaps ?? []).map((gap) => gap.key),
    'audience',
    'languages',
    'decline',
  ];
  return {
    id: draft.id,
    status: draft.status,
    step: draft.step,
    version: draft.version,
    chatbotId: draft.chatbotId ?? null,
    source: {
      website: draft.source?.website ?? null,
      description: draft.source?.description ?? null,
    },
    crawl: {
      status: crawl.status,
      domain: crawl.domain ?? null,
      startedAt: crawl.startedAt ?? null,
      finishedAt: crawl.finishedAt ?? null,
      pagesRead: crawl.pages.filter((p) => p.status === 'read').length,
      pages: crawl.pages
        .filter((p) => p.status === 'read')
        .map((p) => ({ url: p.url, title: p.title })),
      findings: crawl.findings ?? [],
      brand: crawl.brand ?? null,
      problem: crawl.problem ?? null,
    },
    learned: draft.learned,
    industry: draft.industry ?? null,
    safety: pack
      ? {
          id: pack.id,
          name: pack.name,
          industryLabel: pack.industryLabel,
          always: pack.always,
          never: pack.never,
          atRisk: pack.atRisk,
          on: Boolean(draft.safetyPack),
        }
      : null,
    conversation: {
      pending: state.pending,
      gaps: state.gaps,
      questionsLeft: state.gaps
        ? asked.filter((key) => !state.values[key]).length
        : null,
    },
    designs: designCards(draft),
    draft: draft.draftConfig,
    transcript: draft.transcript,
    changes: changes(draft.events),
  };
}

/** The owner's and the builder's changes, for undo (20a-2 shows them on the assistant too). */
export function changes(events: DraftEvent[]) {
  return events
    .filter(
      (e) => e.kind === 'patch' || e.kind === 'undo' || e.kind === 'change',
    )
    .slice(-CHANGES_SHOWN)
    .reverse()
    .map((e) => ({
      id: e.id,
      at: e.at,
      actor: e.actor,
      kind: e.kind,
      target: e.target ?? null,
      summary: e.summary,
      undone: Boolean(e.undoneBy),
    }));
}
