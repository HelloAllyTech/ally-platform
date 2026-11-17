import { PmAgentCard } from '../entity/pm-agent-card.entity';
import { PmAgentOutbox } from '../entity/pm-agent-outbox.entity';
import {
  PmCardCategory,
  PmCardKind,
  PmCardStatus,
  PmOutboxAction,
  PmOutboxStatus,
  PmOutboxStep,
  PmQuestionScope,
} from '../enum/pm-agent.enum';
import { PmCardTransition } from '../repository/pm-agent-card.repository';
import { cardVersionHash } from '../util/card-hash.util';

/**
 * In-memory stand-ins with the SAME conditional semantics as the SQL: a transition only
 * applies when the card is in one of `from` and every guard holds, and a throw inside
 * `also` rolls the card back (the transaction). Async boundaries are preserved so
 * Promise.all races interleave as they would against Postgres.
 */
/** Wall clock under jest's fake timers (setImmediate left real, see `tick`). */
export class FakeClock {
  constructor(start = '2026-11-17T04:00:00.000Z') {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
    jest.setSystemTime(new Date(start));
  }
  get now() {
    return Date.now();
  }
  date() {
    return new Date(this.now);
  }
  advance(ms: number) {
    jest.setSystemTime(new Date(Date.now() + ms));
  }
  restore() {
    jest.useRealTimers();
  }
}

export const recommendationPayload = (over: Record<string, any> = {}) => ({
  schemaVersion: 1,
  title: 'Show the streak count on the roleplay start screen',
  whyHeadline: '41% of learners who see no streak do not return next day',
  change: ['Add a streak chip to the Start screen', 'No new API'],
  problem: 'Learners cannot see their streak before starting a roleplay.',
  plan: {
    steps: ['Read the streak from the existing XP endpoint', 'Render a chip'],
    files: ['ally-web/apps/ally-helpline-dashboard/src/pages/Start.tsx'],
    acceptanceCriteria: ['The chip shows the current streak'],
    testPlan: ['Vitest for the chip'],
    defaultsChosen: ['Hide the chip when the streak is 0'],
  },
  size: 'S',
  risk: 'low',
  riskWhy: 'Display only',
  rollbackNote: 'Revert the pull request',
  impactMetric: { name: 'next-day return rate', direction: 'up' },
  alternativesDropped: ['A push notification'],
  repos: ['ally-web'],
  evidenceIds: ['0b7e7c1e-2f7a-4a43-9a6b-2a6d1f1c0001'],
  ...over,
});

export const questionPayload = (over: Record<string, any> = {}) => ({
  schemaVersion: 1,
  title: 'Which tenants should see streaks first?',
  askedBecause: 'Streak data is thin for small organisations',
  usedFor: 'Choosing the rollout audience',
  options: [
    { label: 'Everyone', consequence: 'Fastest signal', suggested: true },
    { label: 'Large organisations only', consequence: 'Cleaner data' },
  ],
  scope: PmQuestionScope.GLOBAL,
  questionKey: 'streak-rollout-audience',
  ...over,
});

let seq = 0;
export const makeCard = (over: Partial<PmAgentCard> = {}): PmAgentCard => {
  seq += 1;
  const kind = over.kind ?? PmCardKind.RECOMMENDATION;
  const payload =
    over.payload ??
    (kind === PmCardKind.RECOMMENDATION
      ? recommendationPayload()
      : questionPayload());
  const category = over.category ?? PmCardCategory.UI_UX;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    runId: null,
    kind,
    category,
    status: PmCardStatus.OPEN,
    version: 1,
    versionHash: cardVersionHash(kind, category, payload),
    title: payload.title,
    payload,
    rank: 0,
    evidenceFreshness: null,
    questionKey: null,
    revisedFromCardId: null,
    openedAt: new Date('2026-11-17T03:00:00.000Z'),
    decidedAt: null,
    decidedBy: null,
    acceptPath: null,
    undoUntil: null,
    reasonChip: null,
    reason: null,
    needsYouReason: null,
    needsYouDismissedAt: null,
    suppressUntil: null,
    compiledPrd: null,
    compiledPrdHash: null,
    builderSessionId: null,
    roadmapOpportunityId: null,
    createdAt: new Date('2026-11-17T03:00:00.000Z'),
    updatedAt: new Date('2026-11-17T03:00:00.000Z'),
    ...over,
  } as PmAgentCard;
};

const tick = () => new Promise((resolve) => setImmediate(resolve));

export class FakeCardRepository {
  cards = new Map<string, PmAgentCard>();
  events: {
    cardId: string;
    type: string;
    from?: string | null;
    to?: string | null;
  }[] = [];

  constructor(private readonly clock: FakeClock) {}

  add(card: PmAgentCard) {
    this.cards.set(card.id, { ...card });
    return card;
  }

  get(id: string) {
    return this.cards.get(id)!;
  }

  async findOne({ where }: { where: { id: string } }) {
    await tick();
    const card = this.cards.get(where.id);
    return card ? { ...card } : null;
  }

  private matches(params: Pick<PmCardTransition, 'cardId' | 'from' | 'guard'>) {
    const card = this.cards.get(params.cardId);
    if (!card || !params.from.includes(card.status)) return null;
    const guard = params.guard ?? {};
    if (
      guard.undoOpen &&
      !(card.undoUntil && card.undoUntil.getTime() > this.clock.now)
    )
      return null;
    if (guard.versionHash && card.versionHash !== guard.versionHash)
      return null;
    if (
      guard.decidedWithinMs &&
      !(
        card.decidedAt &&
        card.decidedAt.getTime() > this.clock.now - guard.decidedWithinMs
      )
    )
      return null;
    return card;
  }

  async transition(params: PmCardTransition) {
    await tick();
    const card = this.matches(params);
    if (!card) return null;
    const before = { ...card };
    Object.assign(card, params.patch ?? {}, { status: params.to });
    try {
      if (params.also) await params.also({} as never, { ...card });
    } catch (error) {
      this.cards.set(card.id, before); // rollback
      throw error;
    }
    this.events.push({
      cardId: card.id,
      type: params.event.type,
      from: before.status,
      to: params.to,
    });
    return { ...card };
  }

  async patchIf(
    cardId: string,
    statuses: PmCardStatus[],
    patch: Partial<PmAgentCard>,
    event: PmCardTransition['event'],
    guard?: PmCardTransition['guard'],
  ) {
    await tick();
    const card = this.matches({ cardId, from: statuses, guard });
    if (!card) return null;
    Object.assign(card, patch);
    this.events.push({ cardId, type: event.type });
    return { ...card };
  }

  async addEvent(card: { id: string }, type: string) {
    this.events.push({ cardId: card.id, type });
  }

  async update({ id }: { id: string }, patch: Partial<PmAgentCard>) {
    Object.assign(this.cards.get(id)!, patch);
  }

  async listEvents() {
    return [];
  }

  async countOpen() {
    return [...this.cards.values()].filter(
      (c) => c.status === PmCardStatus.OPEN,
    ).length;
  }

  async listByStatuses(statuses: PmCardStatus[]) {
    return [...this.cards.values()]
      .filter((c) => statuses.includes(c.status))
      .map((c) => ({ ...c }));
  }

  async listTenantNames() {
    return ['Acme Health'];
  }
}

/** The outbox with UNIQUE (cardId, action), pending-only delete, and leases. */
export class FakeOutboxRepository {
  rows = new Map<string, PmAgentOutbox>();

  constructor(private readonly clock: FakeClock) {}

  async insertWith(_manager: unknown, row: Partial<PmAgentOutbox>) {
    const exists = [...this.rows.values()].some((r) => r.cardId === row.cardId);
    if (exists)
      throw Object.assign(new Error('duplicate key'), { code: '23505' });
    const id = `ob-${row.cardId}`;
    this.rows.set(id, {
      id,
      action: PmOutboxAction.BUILD,
      status: PmOutboxStatus.PENDING,
      step: PmOutboxStep.CREATE_SESSION,
      attempts: 0,
      lastError: null,
      lockedUntil: null,
      ...row,
    } as PmAgentOutbox);
  }

  async deletePendingWith(_manager: unknown, cardId: string) {
    for (const [id, row] of this.rows) {
      if (row.cardId === cardId && row.status === PmOutboxStatus.PENDING) {
        this.rows.delete(id);
        return { affected: 1 };
      }
    }
    return { affected: 0 };
  }

  async findForCard(cardId: string) {
    return [...this.rows.values()].find((r) => r.cardId === cardId) ?? null;
  }

  forCard(cardId: string) {
    return [...this.rows.values()].find((r) => r.cardId === cardId);
  }

  async listDue() {
    return [...this.rows.values()]
      .filter(
        (r) =>
          [PmOutboxStatus.PENDING, PmOutboxStatus.WAITING].includes(r.status) &&
          r.dueAt.getTime() <= this.clock.now &&
          (!r.lockedUntil || r.lockedUntil.getTime() < this.clock.now),
      )
      .map((r) => r.id);
  }

  async claim(id: string) {
    await tick();
    const row = this.rows.get(id);
    if (
      !row ||
      ![PmOutboxStatus.PENDING, PmOutboxStatus.WAITING].includes(row.status) ||
      row.dueAt.getTime() > this.clock.now ||
      (row.lockedUntil && row.lockedUntil.getTime() >= this.clock.now)
    )
      return null;
    row.status = PmOutboxStatus.RUNNING;
    row.lockedUntil = new Date(this.clock.now + 120_000);
    row.attempts += 1;
    return { ...row };
  }

  async settle(id: string, patch: Partial<PmAgentOutbox>) {
    Object.assign(this.rows.get(id)!, patch, { lockedUntil: null });
  }

  async reopen(cardId: string, step: PmOutboxStep, createdBy: number) {
    const row = this.forCard(cardId);
    if (row) {
      Object.assign(row, {
        status: PmOutboxStatus.PENDING,
        step,
        dueAt: this.clock.date(),
        attempts: 0,
      });
    } else {
      await this.insertWith(null, {
        cardId,
        step,
        dueAt: this.clock.date(),
        createdBy,
      });
    }
  }
}
