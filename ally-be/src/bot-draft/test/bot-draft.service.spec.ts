import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  BotDraftActor,
  BotDraftStatus,
  BotDraftStep,
  Industry,
  LearnedSection,
  SafetyPackId,
} from '../enum/bot-draft.enum';
import { SAFETY_PACKS } from '../safety-pack/safety-packs';
import { BotDraftService } from '../service/bot-draft.service';
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
  const service = new BotDraftService(
    { createQueryBuilder: () => builder, findOne: jest.fn() } as never,
    {} as never,
    { isPlatformAdmin: async () => false } as never,
    events as never,
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
});
