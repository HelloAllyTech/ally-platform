import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  BotDraftActor,
  BotDraftStatus,
  BotDraftStep,
  Industry,
  LearnedSection,
  SafetyPackId,
} from '../enum/bot-draft.enum';
import { STAFF_PACK_REASON, SAFETY_PACKS } from '../safety-pack/safety-packs';
import { LEARNED_FACTS_CHANGED } from '../service/learned-facts-document';
import {
  BotDraftService,
  MAX_DRAFT_EVENTS,
} from '../service/bot-draft.service';
import type { BotDraftEntity } from '../entity/bot-draft.entity';

jest.mock('src/common/execution/execution-manager', () => ({
  ExecutionManager: {
    getUserId: () => 7,
    getTenantId: () => 'tenant-1',
    getExecutionId: () => undefined,
  },
}));

function harness() {
  let stale = false;
  const writes: Record<string, unknown>[] = [];
  const builder = {
    update: () => builder,
    set: (values: Record<string, unknown>) => {
      writes.push(values);
      return builder;
    },
    where: () => builder,
    setParameter: () => builder,
    execute: async () => ({ affected: stale ? 0 : 1 }),
  };
  const events = { publish: jest.fn() };
  const emitter = { emit: jest.fn() };
  const service = new BotDraftService(
    { createQueryBuilder: () => builder, findOne: jest.fn() } as never,
    {} as never,
    { isPlatformAdmin: async () => false } as never,
    events as never,
    emitter as never,
  );
  const draft = (): BotDraftEntity =>
    ({
      id: 'draft-1',
      ownerUserId: 7,
      status: BotDraftStatus.ACTIVE,
      step: BotDraftStep.LEARNED,
      source: {},
      crawl: { status: 'done', queue: [], seen: [], pages: [], findings: [] },
      learned: {
        facts: [
          {
            id: 'f1',
            section: LearnedSection.HOURS,
            text: 'Mon–Sat 9–7',
            sourceUrl: 'https://s.example/contact',
          },
        ],
        dropped: 0,
      },
      answers: {},
      design: {},
      draftConfig: BotDraftService.defaultDraft('Sunrise Mind'),
      transcript: [],
      events: [],
      version: 3,
    }) as unknown as BotDraftEntity;
  return {
    service,
    draft,
    events,
    emitter,
    writes,
    setStale: (v: boolean) => (stale = v),
  };
}

const codeOf = (error: unknown) =>
  ((error as BadRequestException).getResponse() as { errorCode?: string })
    .errorCode;

async function refusal(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return codeOf(error);
  }
  throw new Error('expected a refusal');
}

describe('BotDraftService', () => {
  it('tells the learned-facts document to follow a save, once it exists (Q3-fast Part 2)', async () => {
    const h = harness();
    // Before the facts are a document (during setup), nothing is sent.
    await h.service.update({ ...h.draft(), chatbotId: 'bot-1' } as never, {});
    expect(h.emitter.emit).not.toHaveBeenCalled();

    const withDoc = {
      ...h.draft(),
      chatbotId: 'bot-1',
      tenantId: 'tenant-1',
      source: { learnedFactsDocumentId: 'learned-1' },
    } as never;
    await h.service.update(withDoc, {});
    expect(h.emitter.emit).toHaveBeenCalledWith(
      LEARNED_FACTS_CHANGED,
      expect.objectContaining({
        chatbotId: 'bot-1',
        documentId: 'learned-1',
        ownerUserId: 7,
        facts: [expect.objectContaining({ text: 'Mon–Sat 9–7' })],
      }),
    );

    // A stale save writes nothing, so it tells nothing.
    h.emitter.emit.mockClear();
    h.setStale(true);
    await expect(h.service.update(withDoc, {})).rejects.toThrow();
    expect(h.emitter.emit).not.toHaveBeenCalled();
  });

  it('applies an owner edit, logs it with its inverse, bumps the version and tells the canvas', async () => {
    const h = harness();
    const { draft: saved, event } = await h.service.applyPatch(
      h.draft(),
      [
        {
          op: 'replace',
          path: '/branding/title',
          value: 'Sunrise Mind Clinic',
        },
      ],
      BotDraftActor.OWNER,
      { target: 'draft', expectedVersion: 3 },
    );
    expect(saved.draftConfig.branding.title).toBe('Sunrise Mind Clinic');
    expect(saved.version).toBe(4);
    expect(event.inverse).toEqual([
      { op: 'replace', path: '/branding/title', value: 'Sunrise Mind' },
    ]);
    expect(saved.events).toHaveLength(1);
    expect(h.events.publish).toHaveBeenCalledWith(
      'draft-1',
      expect.objectContaining({ type: 'patched', version: 4 }),
    );
  });

  it.each([
    [BotDraftActor.BUILDER, '/access/mode', 'public'],
    [BotDraftActor.BUILDER, '/extraNever/-', 'x'],
    [BotDraftActor.BUILDER, '/safetyPackId', 'standard'],
    [BotDraftActor.OWNER, '/safetyPackId', 'standard'],
    [
      BotDraftActor.OWNER,
      '/knowledgeDocumentIds/-',
      '6f9c1a52-1111-4a8e-9a0c-1b2c3d4e5f60',
    ],
  ])('refuses %s changing %s', async (actor, path, value) => {
    const h = harness();
    expect(
      await refusal(
        h.service.applyPatch(h.draft(), [{ op: 'add', path, value }], actor, {
          target: 'draft',
        }),
      ),
    ).toBe('path_not_allowed');
  });

  it('keeps the newest 200 changes per bot, dropping the oldest', async () => {
    const { service, draft, writes } = harness();
    const edit = (n: number) =>
      ({ id: `e${n}`, at: '2026-11-10T00:00:00Z', kind: 'edit' }) as never;
    const full = {
      ...draft(),
      events: Array.from({ length: MAX_DRAFT_EVENTS }, (_, n) => edit(n)),
    };
    const saved = await service.update(full, {}, [edit(MAX_DRAFT_EVENTS)]);
    expect(MAX_DRAFT_EVENTS).toBe(200);
    expect(saved.events).toHaveLength(200);
    expect(saved.events[0].id).toBe('e1');
    expect(saved.events[saved.events.length - 1].id).toBe('e200');
    expect((writes[writes.length - 1].events as unknown[]).length).toBe(200);
  });

  it('refuses a result that is not a valid draft', async () => {
    const h = harness();
    expect(
      await refusal(
        h.service.applyPatch(
          h.draft(),
          [{ op: 'replace', path: '/tone', value: 'shouty' }],
          BotDraftActor.BUILDER,
          {
            target: 'draft',
          },
        ),
      ),
    ).toBe('invalid_draft');
    expect(
      await refusal(
        h.service.applyPatch(
          h.draft(),
          [
            {
              op: 'replace',
              path: '/suggestedQuestions',
              value: ['a', 'b', 'c', 'd', 'e'],
            },
          ],
          BotDraftActor.BUILDER,
          { target: 'draft' },
        ),
      ),
    ).toBe('invalid_draft');
  });

  it("refuses removing a health pack's disclaimer with safety_locked", async () => {
    const h = harness();
    const base = h.draft();
    base.draftConfig = {
      ...base.draftConfig,
      safetyPackId: SafetyPackId.MENTAL_HEALTH,
      branding: {
        ...base.draftConfig.branding,
        disclaimer: SAFETY_PACKS.mental_health.disclaimer!,
      },
    };
    expect(
      await refusal(
        h.service.applyPatch(
          base,
          [{ op: 'replace', path: '/branding/disclaimer', value: '' }],
          BotDraftActor.OWNER,
          {
            target: 'draft',
          },
        ),
      ),
    ).toBe('safety_locked');
  });

  it('refuses an edit made on an older version', async () => {
    const h = harness();
    await expect(
      h.service.applyPatch(
        h.draft(),
        [{ op: 'replace', path: '/name', value: 'X' }],
        BotDraftActor.OWNER,
        {
          target: 'draft',
          expectedVersion: 2,
        },
      ),
    ).rejects.toThrow(ConflictException);
    h.setStale(true);
    await expect(
      h.service.applyPatch(
        h.draft(),
        [{ op: 'replace', path: '/name', value: 'X' }],
        BotDraftActor.OWNER,
        {
          target: 'draft',
        },
      ),
    ).rejects.toThrow(ConflictException);
  });

  describe('what we learned', () => {
    it('the builder only adds sourced facts', async () => {
      const h = harness();
      const fact = {
        id: 'f2',
        section: 'team',
        text: '6 counsellors',
        sourceUrl: 'https://s.example/team',
      };
      const { draft } = await h.service.applyPatch(
        h.draft(),
        [{ op: 'add', path: '/facts/-', value: fact }],
        BotDraftActor.BUILDER,
        {
          target: 'learned',
        },
      );
      expect(draft.learned.facts).toHaveLength(2);
      expect(
        await refusal(
          h.service.applyPatch(
            h.draft(),
            [
              {
                op: 'add',
                path: '/facts/-',
                value: { ...fact, sourceUrl: '' },
              },
            ],
            BotDraftActor.BUILDER,
            {
              target: 'learned',
            },
          ),
        ),
      ).toBe('invalid_fact');
      expect(
        await refusal(
          h.service.applyPatch(
            h.draft(),
            [{ op: 'remove', path: '/facts/0' }],
            BotDraftActor.BUILDER,
            { target: 'learned' },
          ),
        ),
      ).toBe('path_not_allowed');
    });

    it('the owner edits and removes facts', async () => {
      const h = harness();
      const edited = await h.service.applyPatch(
        h.draft(),
        [{ op: 'replace', path: '/facts/0/text', value: 'Mon–Sun 9–7' }],
        BotDraftActor.OWNER,
        {
          target: 'learned',
        },
      );
      expect(edited.draft.learned.facts[0].text).toBe('Mon–Sun 9–7');
      const removed = await h.service.applyPatch(
        h.draft(),
        [{ op: 'remove', path: '/facts/0' }],
        BotDraftActor.OWNER,
        { target: 'learned' },
      );
      expect(removed.draft.learned.facts).toHaveLength(0);
    });
  });

  describe('an edited fact', () => {
    it('becomes the owner’s ("From you"), and Undo puts its source back', async () => {
      const h = harness();
      const { draft: edited, event } = await h.service.applyPatch(
        h.draft(),
        [{ op: 'replace', path: '/facts/0/text', value: 'Mon–Sun 9–7' }],
        BotDraftActor.OWNER,
        { target: 'learned' },
      );
      expect(edited.learned.facts[0]).toMatchObject({
        text: 'Mon–Sun 9–7',
        byOwner: true,
      });
      const undone = await h.service.undo(edited, event.id);
      expect(undone.learned.facts[0].byOwner).toBeUndefined();
      expect(undone.learned.facts[0].text).not.toBe('Mon–Sun 9–7');
    });

    it('stays the builder’s when only the builder adds it', async () => {
      const h = harness();
      const { draft } = await h.service.applyPatch(
        h.draft(),
        [
          {
            op: 'add',
            path: '/facts/-',
            value: {
              id: 'f9',
              section: 'hours',
              text: 'Open daily.',
              sourceUrl: 'https://sunrise.example/',
            },
          },
        ],
        BotDraftActor.BUILDER,
        { target: 'learned' },
      );
      expect(
        draft.learned.facts[draft.learned.facts.length - 1].byOwner,
      ).toBeUndefined();
    });
  });

  describe('undo', () => {
    it('puts a change back and marks it undone', async () => {
      const h = harness();
      const { draft: changed, event } = await h.service.applyPatch(
        h.draft(),
        [{ op: 'replace', path: '/name', value: 'Renamed' }],
        BotDraftActor.OWNER,
        { target: 'draft' },
      );
      const undone = await h.service.undo(changed, event.id);
      expect(undone.draftConfig.name).toBe('Sunrise Mind');
      expect(
        undone.events.find((e) => e.id === event.id)?.undoneBy,
      ).toBeTruthy();
      expect(undone.events[undone.events.length - 1].kind).toBe('undo');
    });

    it('refuses when a later change touched the same thing', async () => {
      const h = harness();
      const first = await h.service.applyPatch(
        h.draft(),
        [{ op: 'replace', path: '/name', value: 'A' }],
        BotDraftActor.OWNER,
        { target: 'draft' },
      );
      const second = await h.service.applyPatch(
        first.draft,
        [{ op: 'replace', path: '/name', value: 'B' }],
        BotDraftActor.OWNER,
        { target: 'draft' },
      );
      await expect(
        h.service.undo(second.draft, first.event.id),
      ).rejects.toThrow(/later change/);
    });
  });

  it('Back goes one step and keeps the edits', async () => {
    const h = harness();
    const base = { ...h.draft(), step: BotDraftStep.DESIGN };
    const back = await h.service.back(base as BotDraftEntity);
    expect(back.step).toBe(BotDraftStep.GAPS);
    expect(back.draftConfig).toEqual(base.draftConfig);
  });

  it('only ever raises the safety pack, and puts its disclaimer on the page', async () => {
    const h = harness();
    const health = await h.service.setSafety(
      h.draft(),
      Industry.MENTAL_HEALTH,
      SafetyPackId.MENTAL_HEALTH,
    );
    expect(health.safetyPack).toBe(SafetyPackId.MENTAL_HEALTH);
    expect(health.draftConfig.branding.disclaimer).toBe(
      SAFETY_PACKS.mental_health.disclaimer,
    );
    const again = await h.service.setSafety(
      health,
      Industry.WELLNESS,
      SafetyPackId.STANDARD,
    );
    expect(again.safetyPack).toBe(SafetyPackId.MENTAL_HEALTH);
  });

  it('never writes a placeholder ("unchanged") as a name (Q4 N1)', async () => {
    const h = harness();
    const draft = h.draft();
    const { draft: after } = await h.service.applyPatch(
      draft,
      [
        { op: 'replace', path: '/assistantName', value: 'unchanged' },
        { op: 'replace', path: '/name', value: 'unchanged' },
        { op: 'replace', path: '/introduction', value: 'Hello there.' },
      ],
      BotDraftActor.BUILDER,
      { target: 'draft' },
    );
    expect(after.draftConfig.assistantName).toBe(
      draft.draftConfig.assistantName,
    );
    expect(after.draftConfig.name).toBe(draft.draftConfig.name);
    expect(after.draftConfig.introduction).toBe('Hello there.');
  });

  describe('the owner corrects the pack in setup (Q4 A3)', () => {
    const onMentalHealth = async () => {
      const h = harness();
      const draft = await h.service.setSafety(
        h.draft(),
        Industry.REAL_ESTATE,
        SafetyPackId.MENTAL_HEALTH,
      );
      return { h, draft };
    };

    it('less strict needs a reason, which is recorded with the change', async () => {
      const { h, draft } = await onMentalHealth();
      await expect(
        h.service.correctPack(draft, SafetyPackId.STANDARD, ''),
      ).rejects.toMatchObject({ response: { errorCode: 'reason_required' } });
      const fixed = await h.service.correctPack(
        draft,
        SafetyPackId.STANDARD,
        "We're a coworking space, not mental health",
      );
      expect(fixed.safetyPack).toBe(SafetyPackId.STANDARD);
      expect(fixed.draftConfig.safetyPackId).toBe(SafetyPackId.STANDARD);
      expect(fixed.draftConfig.packChange).toMatchObject({
        from: 'mental_health',
        to: 'standard',
        lessStrict: true,
        reason: "We're a coworking space, not mental health",
      });
      // The old pack's disclaimer goes with it.
      expect(fixed.draftConfig.branding.disclaimer ?? '').not.toContain(
        SAFETY_PACKS.mental_health.disclaimer,
      );
    });

    it('stricter applies at once, with no reason', async () => {
      const h = harness();
      const fixed = await h.service.correctPack(
        h.draft(),
        SafetyPackId.MEDICAL,
      );
      expect(fixed.safetyPack).toBe(SafetyPackId.MEDICAL);
      expect(fixed.draftConfig.packChange?.lessStrict).toBe(false);
    });

    it('an unknown pack is refused', async () => {
      const h = harness();
      await expect(
        h.service.correctPack(h.draft(), 'magic'),
      ).rejects.toMatchObject({ response: { errorCode: 'invalid_pack' } });
    });
  });

  describe("a staff assistant's pack follows its readers (Q4 H4)", () => {
    it('made "Train my team" after a sector pack was chosen: Standard, with the reason', async () => {
      const h = harness();
      const draft = await h.service.setSafety(
        h.draft(),
        Industry.MENTAL_HEALTH,
        SafetyPackId.MENTAL_HEALTH,
      );
      const { draft: saved } = await h.service.applyPatch(
        draft,
        [{ op: 'replace', path: '/purpose', value: 'training' }],
        BotDraftActor.OWNER,
        { target: 'draft' },
      );
      expect(saved.draftConfig.safetyPackId).toBe(SafetyPackId.STANDARD);
      expect(saved.draftConfig.packChange).toMatchObject({
        from: 'mental_health',
        to: 'standard',
        reason: STAFF_PACK_REASON,
      });
    });

    it('never undoes a pack the owner chose', async () => {
      const h = harness();
      const chosen = await h.service.correctPack(
        h.draft(),
        SafetyPackId.MENTAL_HEALTH,
      );
      const { draft: saved } = await h.service.applyPatch(
        chosen,
        [{ op: 'replace', path: '/purpose', value: 'training' }],
        BotDraftActor.OWNER,
        { target: 'draft' },
      );
      expect(saved.draftConfig.safetyPackId).toBe(SafetyPackId.MENTAL_HEALTH);
    });
  });
});
