import {
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PmAgentCardService } from '../service/pm-agent-card.service';
import { PmAgentPresenterService } from '../service/pm-agent-presenter.service';
import {
  PmAcceptPath,
  PmCardKind,
  PmCardStatus,
  PmDecision,
  PmMemorySource,
  PmOutboxStatus,
  PmOutboxStep,
  PmRejectReasonChip,
} from '../enum/pm-agent.enum';
import {
  FakeCardRepository,
  FakeClock,
  FakeOutboxRepository,
  makeCard,
} from './pm-agent.fakes';

/**
 * The card state machine. The fakes enforce the same conditional semantics as the SQL
 * (status IN :from + guards; a throw inside the transaction rolls back), so these specs
 * exercise the real decision logic: races, the undo window, slot accounting.
 */
describe('PmAgentCardService — the card state machine', () => {
  let clock: FakeClock;
  let cards: FakeCardRepository;
  let outbox: FakeOutboxRepository;
  let memory: { insertWith: jest.Mock; update: jest.Mock; facts: any[] };
  let feedbackRows: { insertWith: jest.Mock; rows: any[] };
  let outcomes: { recordDecisionWith: jest.Mock; flag: jest.Mock };
  let laneStats: { bump: jest.Mock };
  let settings: { getSingleton: jest.Mock };
  let events: { cardUpdated: jest.Mock; stateUpdated: jest.Mock };
  let runTrigger: { runNow: jest.Mock; reviseNow: jest.Mock };
  let service: PmAgentCardService;
  const ADMIN = 7;
  const OTHER_ADMIN = 8;

  beforeEach(() => {
    clock = new FakeClock();
    cards = new FakeCardRepository(clock);
    outbox = new FakeOutboxRepository(clock);
    memory = {
      facts: [],
      insertWith: jest.fn(async (_m, fact) => {
        memory.facts.push(fact);
      }),
      update: jest.fn(),
    };
    feedbackRows = {
      rows: [],
      insertWith: jest.fn(async (_m, row) => {
        const saved = { id: `fb-${feedbackRows.rows.length + 1}`, ...row };
        feedbackRows.rows.push(saved);
        return saved;
      }),
    };
    outcomes = {
      recordDecisionWith: jest.fn(),
      flag: jest.fn(),
    };
    laneStats = { bump: jest.fn().mockResolvedValue(undefined) };
    settings = { getSingleton: jest.fn().mockResolvedValue({ queueCap: 5 }) };
    events = { cardUpdated: jest.fn(), stateUpdated: jest.fn() };
    runTrigger = {
      runNow: jest.fn(),
      reviseNow: jest.fn().mockResolvedValue(undefined),
    };
    const presenter = {
      present: jest.fn(async (rows: any[]) =>
        rows.map((row) => PmAgentPresenterService.toResponse(row)),
      ),
      presentOne: jest.fn(async (row: any) =>
        PmAgentPresenterService.toResponse(row),
      ),
    };
    service = new PmAgentCardService(
      cards as never,
      { listByIds: jest.fn().mockResolvedValue([]) } as never,
      outbox as never,
      feedbackRows as never,
      memory as never,
      outcomes as never,
      laneStats as never,
      settings as never,
      presenter as never,
      events as never,
      runTrigger,
    );
  });

  afterEach(() => clock.restore());

  describe('accept files to the roadmap', () => {
    it('moves to accepted_pending with a 10 s undo window and a not-yet-due outbox row', async () => {
      const card = cards.add(makeCard());

      const result = await service.accept(ADMIN, card.id, {});

      expect(result.status).toBe(PmCardStatus.ACCEPTED_PENDING);
      expect(new Date(result.undoUntil!).getTime()).toBe(clock.now + 10_000);
      const row = outbox.forCard(card.id)!;
      expect(row.status).toBe(PmOutboxStatus.PENDING);
      expect(row.dueAt.getTime()).toBe(clock.now + 10_000);
      expect(row.createdBy).toBe(ADMIN);
      expect(outcomes.recordDecisionWith).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          decision: PmDecision.ACCEPTED,
          decisionLatencyMs: 60 * 60 * 1000,
        }),
      );
      expect(events.cardUpdated).toHaveBeenCalledWith(card.id);
    });

    it('lets exactly one of two racing admins accept (409 for the other, one outbox row)', async () => {
      const card = cards.add(makeCard());

      const results = await Promise.allSettled([
        service.accept(ADMIN, card.id, {}),
        service.accept(OTHER_ADMIN, card.id, {}),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const lost = results.find(
        (r) => r.status === 'rejected',
      ) as PromiseRejectedResult;
      expect(lost.reason).toBeInstanceOf(ConflictException);
      expect(outbox.rows.size).toBe(1);
    });

    it('refuses an accept bound to a stale version hash', async () => {
      const card = cards.add(makeCard());

      await expect(
        service.accept(ADMIN, card.id, {
          versionHash: 'not-the-hash',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(cards.get(card.id).status).toBe(PmCardStatus.OPEN);
    });

    it('records the roadmap path and a file_roadmap outbox row, whatever path an old client sends', async () => {
      const card = cards.add(makeCard());

      await service.accept(ADMIN, card.id, { path: PmAcceptPath.DOWNLOAD });

      expect(cards.get(card.id).acceptPath).toBe(PmAcceptPath.ROADMAP);
      expect(outbox.forCard(card.id)).toMatchObject({
        step: PmOutboxStep.FILE_ROADMAP,
        status: PmOutboxStatus.PENDING,
      });
    });

    it('refuses a card written before roadmap filing (no roadmap entry, 422)', async () => {
      const payload = { ...makeCard().payload };
      delete payload.opportunity;
      const card = cards.add(makeCard({ payload }));

      await expect(service.accept(ADMIN, card.id, {})).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
      expect(cards.get(card.id).status).toBe(PmCardStatus.OPEN);
      expect(outbox.rows.size).toBe(0);
    });

    it('refuses to accept a question (422)', async () => {
      const card = cards.add(makeCard({ kind: PmCardKind.QUESTION }));

      await expect(service.accept(ADMIN, card.id, {})).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
    });
  });

  describe('undo', () => {
    it('restores the card to open and deletes the outbox row inside the window', async () => {
      const card = cards.add(makeCard());
      await service.accept(ADMIN, card.id, {});
      clock.advance(9_000);

      const result = await service.undo(ADMIN, card.id);

      expect(result.status).toBe(PmCardStatus.OPEN);
      expect(result.undoUntil).toBeNull();
      expect(outbox.rows.size).toBe(0);
      expect(outcomes.recordDecisionWith).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.objectContaining({ undone: true }),
      );
    });

    it('answers 409 once the window has closed', async () => {
      const card = cards.add(makeCard());
      await service.accept(ADMIN, card.id, {});
      clock.advance(10_001);

      await expect(service.undo(ADMIN, card.id)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(cards.get(card.id).status).toBe(PmCardStatus.ACCEPTED_PENDING);
      expect(outbox.rows.size).toBe(1);
    });

    it('answers 409 (and rolls back) when the worker already claimed the row', async () => {
      const card = cards.add(makeCard());
      await service.accept(ADMIN, card.id, {});
      outbox.forCard(card.id)!.status = PmOutboxStatus.RUNNING;

      await expect(service.undo(ADMIN, card.id)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(cards.get(card.id).status).toBe(PmCardStatus.ACCEPTED_PENDING);
      expect(outbox.forCard(card.id)!.status).toBe(PmOutboxStatus.RUNNING);
    });

    it('a card can be accepted again after an undo (the unique outbox row is gone)', async () => {
      const card = cards.add(makeCard());
      await service.accept(ADMIN, card.id, {});
      await service.undo(ADMIN, card.id);

      const again = await service.accept(ADMIN, card.id, {});

      expect(again.status).toBe(PmCardStatus.ACCEPTED_PENDING);
      expect(outbox.rows.size).toBe(1);
    });
  });

  describe('reject', () => {
    it('records a structured "do not propose" memory fact with the chip', async () => {
      const card = cards.add(makeCard());

      const result = await service.reject(ADMIN, card.id, {
        reasonChip: PmRejectReasonChip.ALREADY_PLANNED,
      });

      expect(result.status).toBe(PmCardStatus.REJECTED);
      expect(memory.facts[0]).toMatchObject({
        source: PmMemorySource.REJECTION,
        sourceCardId: card.id,
      });
      expect(memory.facts[0].value).toContain('already planned');
      expect(laneStats.bump).toHaveBeenCalledWith(
        'category',
        'ui_ux',
        'rejected',
      );
    });

    it('takes a reason within 30 s and refuses one after', async () => {
      const card = cards.add(makeCard());
      await service.reject(ADMIN, card.id, {});
      clock.advance(20_000);

      const updated = await service.setReason(ADMIN, card.id, {
        reasonChip: PmRejectReasonChip.TOO_RISKY,
        reason: 'touches scoring',
      });
      expect(updated.reasonChip).toBe(PmRejectReasonChip.TOO_RISKY);
      expect(memory.update).toHaveBeenCalled();

      clock.advance(11_000);
      await expect(
        service.setReason(ADMIN, card.id, { reason: 'late' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('cannot reject a card that was already accepted (409)', async () => {
      const card = cards.add(makeCard());
      await service.accept(ADMIN, card.id, {});

      await expect(
        service.reject(OTHER_ADMIN, card.id, {}),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('feedback', () => {
    it('closes the card, files a pending revision task, and only flags revise-now', async () => {
      const card = cards.add(makeCard());

      const result = await service.feedback(ADMIN, card.id, {
        text: 'Smaller scope please',
        chips: ['smaller_scope'],
        reviseNow: true,
      });

      expect(result.status).toBe(PmCardStatus.FEEDBACK_CLOSED);
      expect(feedbackRows.rows[0]).toMatchObject({
        cardId: card.id,
        status: 'pending',
        reviseNow: true,
        chips: ['smaller_scope'],
      });
      expect(runTrigger.reviseNow).toHaveBeenCalledWith('fb-1', ADMIN);
    });

    it('does not trigger a revision when reviseNow is off', async () => {
      const card = cards.add(makeCard());

      await service.feedback(ADMIN, card.id, { text: 'Not now' });

      expect(runTrigger.reviseNow).not.toHaveBeenCalled();
    });
  });

  describe('questions', () => {
    it('answering writes a memory fact keyed by the question', async () => {
      const card = cards.add(
        makeCard({ kind: PmCardKind.QUESTION, questionKey: 'streak-rollout' }),
      );

      const result = await service.answer(ADMIN, card.id, { optionIndex: 1 });

      expect(result.status).toBe(PmCardStatus.ANSWERED);
      expect(memory.facts[0]).toMatchObject({
        key: 'streak-rollout',
        source: PmMemorySource.ANSWER,
      });
      expect(memory.facts[0].value).toContain('Large organisations only');
    });

    it('needs exactly one of optionIndex / customText, and a real option', async () => {
      const card = cards.add(makeCard({ kind: PmCardKind.QUESTION }));

      await expect(service.answer(ADMIN, card.id, {})).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
      await expect(
        service.answer(ADMIN, card.id, { optionIndex: 3 }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('skipping suppresses the question for 14 days', async () => {
      const card = cards.add(makeCard({ kind: PmCardKind.QUESTION }));

      await service.skip(ADMIN, card.id);

      const stored = cards.get(card.id);
      expect(stored.status).toBe(PmCardStatus.SKIPPED);
      expect(stored.questionKey).toBe('streak-rollout-audience');
      expect(stored.suppressUntil!.getTime()).toBe(
        clock.now + 14 * 24 * 60 * 60 * 1000,
      );
    });
  });

  describe('slots', () => {
    it('every decision frees a slot: free = cap − open', async () => {
      const open = [1, 2, 3, 4, 5].map(() => cards.add(makeCard()));
      expect(await service.freeSlots()).toBe(0);

      await service.accept(ADMIN, open[0].id, {});
      await service.reject(ADMIN, open[1].id, {});
      await service.feedback(ADMIN, open[2].id, { text: 'x' });

      expect(await service.freeSlots()).toBe(3);

      // Undo puts the card back in the queue and takes the slot again.
      await service.undo(ADMIN, open[0].id);
      expect(await service.freeSlots()).toBe(2);
    });
  });

  describe('needs-you actions', () => {
    it('retry moves a stopped card back to queued and reopens its outbox row at filing', async () => {
      const card = cards.add(
        makeCard({
          status: PmCardStatus.NEEDS_ATTENTION,
          needsYouReason: 'The roadmap refused the filing.',
          decidedBy: ADMIN,
        }),
      );
      await outbox.insertWith(null, {
        cardId: card.id,
        dueAt: clock.date(),
        createdBy: ADMIN,
        step: PmOutboxStep.FILE_ROADMAP,
        status: PmOutboxStatus.FAILED,
      });

      const result = await service.retry(ADMIN, card.id);

      expect(result.status).toBe(PmCardStatus.QUEUED);
      expect(cards.get(card.id).needsYouReason).toBeNull();
      expect(outbox.forCard(card.id)).toMatchObject({
        status: PmOutboxStatus.PENDING,
        step: PmOutboxStep.FILE_ROADMAP,
      });
    });

    it('retry is refused for a card that is not stopped (409)', async () => {
      const card = cards.add(makeCard());

      await expect(service.retry(ADMIN, card.id)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('a duplicate stop offers File anyway, which records who overrode it and refiles', async () => {
      const duplicates = [
        { id: 'opp-1', code: 'OPP-0101', reason: 'Same streak chip' },
      ];
      const card = cards.add(
        makeCard({
          status: PmCardStatus.NEEDS_ATTENTION,
          needsYouReason: 'This looks like OPP-0101 already on the roadmap.',
          roadmapFiling: { duplicates },
          decidedBy: ADMIN,
        }),
      );

      const before = PmAgentPresenterService.toResponse(cards.get(card.id));
      expect(before.needsYou).toMatchObject({
        actions: ['file_anyway', 'dismiss'],
        duplicates,
      });

      const result = await service.fileAnyway(OTHER_ADMIN, card.id);

      expect(result.status).toBe(PmCardStatus.QUEUED);
      expect(cards.get(card.id).roadmapFiling).toMatchObject({
        duplicates,
        fileAnyway: { by: OTHER_ADMIN },
      });
      expect(outbox.forCard(card.id)!.step).toBe(PmOutboxStep.FILE_ROADMAP);
    });

    it('File anyway is refused for a stop that was not a duplicate (409)', async () => {
      const card = cards.add(
        makeCard({ status: PmCardStatus.NEEDS_ATTENTION }),
      );

      await expect(service.fileAnyway(ADMIN, card.id)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('dismiss takes the item off the needs-you list without changing status', async () => {
      const card = cards.add(
        makeCard({ status: PmCardStatus.NEEDS_ATTENTION }),
      );

      const before = PmAgentPresenterService.toResponse(cards.get(card.id));
      expect(before.needsYou?.actions).toEqual(['retry', 'dismiss']);

      const result = await service.dismiss(ADMIN, card.id);

      expect(result.status).toBe(PmCardStatus.NEEDS_ATTENTION);
      expect(result.needsYou).toBeUndefined();
    });
  });
});
