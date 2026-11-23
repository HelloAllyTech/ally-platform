import { ChatbotStatus } from '../../chatbot/enum/chatbot.enum';
import { BotDraftStatus } from '../enum/bot-draft.enum';
import {
  fieldVersion,
  mergeWithLive,
  STAGED_FIELDS,
  workingValues,
  type StagedField,
} from '../working-copy/staged-fields';
import {
  baseOf,
  WorkingCopyService,
} from '../working-copy/working-copy.service';
import { memoryDrafts } from './memory-drafts';

/** A live chatbot row, as the working copy reads it. */
function liveBot(over: Record<string, unknown> = {}) {
  return {
    id: 'bot-1',
    name: 'Sunrise Mind',
    status: ChatbotStatus.LIVE,
    createdBy: 7,
    persona: {
      displayName: 'Sunrise Mind',
      greeting: 'Hello',
      tone: 'warm',
      systemPrompt: 'Be kind.',
      defaultLanguage: 'en',
    },
    settings: {},
    rules: { never: [] },
    ...over,
  } as never;
}

function harness(
  opts: {
    status?: ChatbotStatus;
    credits?: boolean;
    check?: unknown;
    working?: Record<string, unknown>;
  } = {},
) {
  let chatbot = liveBot({ status: opts.status ?? ChatbotStatus.LIVE }) as {
    [k: string]: unknown;
  };
  const writes: string[] = [];
  const pages = {
    view: jest.fn(async () => ({ settings: { suggestedQuestions: [] } })),
    findForChatbot: jest.fn(async () => null),
  };
  const knowledge = { getForChatbot: jest.fn(async () => ({ rawText: '' })) };
  const home = {
    saveField: jest.fn(
      async (_id: string, dto: { field: string; value: unknown }) => {
        writes.push(dto.field);
        const persona = { ...(chatbot.persona as object) } as Record<
          string,
          unknown
        >;
        if (dto.field === 'name') chatbot = { ...chatbot, name: dto.value };
        if (dto.field === 'instructions') persona.systemPrompt = dto.value;
        if (dto.field === 'introduction') persona.greeting = dto.value;
        chatbot = { ...chatbot, persona };
        return {};
      },
    ),
  };
  const publisher = {
    ownerNotes: jest.fn(async () => null),
    learnedFacts: jest.fn(async () => null),
  };
  const chatbots = {
    findOne: jest.fn(async () => chatbot),
    update: jest.fn(async () => ({ affected: 1 })),
  };
  const chatbotDocuments = {
    find: jest.fn(async () => [{ documentId: 'doc-live' }]),
    manager: { query: jest.fn(async () => []) },
  };
  const safety = {
    check: jest.fn(
      async () => opts.check ?? { ok: true as const, warnings: [] },
    ),
  };
  const credits = {
    creditsAvailable: jest.fn(async () => opts.credits ?? true),
  };
  const access = { assert: jest.fn(async () => ({ chatbot })) };

  // The working copy starts in step with live.
  const config = {
    ...memoryDrafts().row().draftConfig,
    name: 'Sunrise Mind',
    assistantName: 'Sunrise Mind',
    introduction: 'Hello',
    tone: 'warm',
    instructions: 'Be kind.',
    languages: ['en'],
    suggestedQuestions: [],
    declineText: '',
    extraNever: [],
    ownerNotes: '',
  } as never;
  const live = workingValues(config);
  const store = memoryDrafts({
    status: BotDraftStatus.PUBLISHED,
    liveAt: new Date(),
    liveBase: baseOf(live),
    draftConfig: { ...(config as object), ...(opts.working ?? {}) } as never,
  });
  const service = new WorkingCopyService(
    store.service,
    access as never,
    pages as never,
    knowledge as never,
    home as never,
    publisher as never,
    chatbots as never,
    chatbotDocuments as never,
    safety as never,
    credits as never,
  );
  const ctx = async () => service.forDraft('draft-1');
  return {
    service,
    store,
    home,
    chatbots,
    safety,
    credits,
    writes,
    ctx,
    chatbot: () => chatbot,
  };
}

describe('mergeWithLive (the per-field three-way merge)', () => {
  const vals = (over: Partial<Record<StagedField, unknown>> = {}) => {
    const out = {} as Record<StagedField, unknown>;
    for (const f of STAGED_FIELDS) out[f] = '';
    return { ...out, ...over } as Record<StagedField, unknown>;
  };
  const base = (v: Record<StagedField, unknown>) => {
    const b: Record<string, string> = {};
    for (const f of STAGED_FIELDS) b[f] = fieldVersion(v[f]);
    return b;
  };

  it('adopts the live value when there is no base yet (a chatbot made by hand)', () => {
    const r = mergeWithLive(vals({ name: 'Old' }), vals({ name: 'Live' }), {});
    expect(r.adopt).toEqual({ name: 'Live' });
    expect(r.pending).toEqual([]);
  });

  it('follows an edit made on the live chatbot elsewhere when the working copy was not edited', () => {
    const agreed = vals({ instructions: 'A' });
    const r = mergeWithLive(agreed, vals({ instructions: 'B' }), base(agreed));
    expect(r.adopt).toEqual({ instructions: 'B' });
    expect(r.pending).toEqual([]);
  });

  it('keeps a working-copy edit pending, and flags a live edit made meanwhile', () => {
    const agreed = vals({ instructions: 'A' });
    const r = mergeWithLive(
      vals({ instructions: 'Mine' }),
      vals({ instructions: 'Theirs' }),
      base(agreed),
    );
    expect(r.pending).toEqual(['instructions']);
    expect(r.conflicted).toEqual(['instructions']);
  });
});

describe('WorkingCopyService', () => {
  it('treats a published draft or a live chatbot as live', () => {
    expect(
      WorkingCopyService.isLive(
        { status: BotDraftStatus.ACTIVE } as never,
        { status: ChatbotStatus.LIVE } as never,
      ),
    ).toBe(true);
    expect(
      WorkingCopyService.isLive(
        { status: BotDraftStatus.ACTIVE } as never,
        { status: ChatbotStatus.DRAFT } as never,
      ),
    ).toBe(false);
  });

  describe('editing one field', () => {
    it('writes the working copy only, never the live chatbot', async () => {
      const h = harness();
      const ctx = await h.ctx();
      const result = await h.service.editField(
        ctx,
        'instructions',
        'Be brief.',
        fieldVersion('Be kind.'),
      );
      expect(result).toMatchObject({ value: 'Be brief.', staged: true });
      expect(h.store.row().draftConfig.instructions).toBe('Be brief.');
      expect(h.home.saveField).not.toHaveBeenCalled();
      expect(h.chatbots.update).not.toHaveBeenCalled();
    });

    it('lets two edits to different fields both land (two tabs)', async () => {
      const h = harness();
      const tabA = await h.ctx();
      const tabB = await h.ctx();
      await h.service.editField(
        tabA,
        'introduction',
        'Hi there',
        fieldVersion('Hello'),
      );
      // Tab B still holds the draft as it was before tab A's save.
      await h.service.editField(
        tabB,
        'instructions',
        'Be brief.',
        fieldVersion('Be kind.'),
      );
      const row = h.store.row().draftConfig;
      expect(row.introduction).toBe('Hi there');
      expect(row.instructions).toBe('Be brief.');
    });

    it('refuses a stale edit to the same field with the current value and version', async () => {
      const h = harness();
      await h.service.editField(
        await h.ctx(),
        'instructions',
        'Tab A',
        fieldVersion('Be kind.'),
      );
      await expect(
        h.service.editField(
          await h.ctx(),
          'instructions',
          'Tab B',
          fieldVersion('Be kind.'),
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          errorCode: 'stale_field',
          details: {
            field: 'instructions',
            value: 'Tab A',
            version: fieldVersion('Tab A'),
          },
        }),
      });
      expect(h.store.row().draftConfig.instructions).toBe('Tab A');
    });

    it('keeps the value when an edit is refused, and returns it for the client', async () => {
      const h = harness();
      await expect(
        h.service.editField(
          await h.ctx(),
          'tone',
          'furious',
          fieldVersion('warm'),
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          details: expect.objectContaining({
            field: 'tone',
            value: 'warm',
            version: fieldVersion('warm'),
          }),
        }),
      });
      expect(h.store.row().draftConfig.tone).toBe('warm');
    });

    it('refuses an operational control (who can use it) as a working-copy field', async () => {
      const h = harness();
      await expect(
        h.service.editField(await h.ctx(), 'access', {}, fieldVersion(null)),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ errorCode: 'unknown_field' }),
      });
    });
  });

  describe('pending', () => {
    it('lists each changed field with its live and working value', async () => {
      const h = harness({ working: { instructions: 'Be brief.' } });
      const pending = await h.service.pending(await h.ctx());
      expect(pending.live).toBe(true);
      expect(pending.changes).toEqual([
        expect.objectContaining({
          field: 'instructions',
          live: 'Be kind.',
          working: 'Be brief.',
          safetyRelevant: true,
        }),
      ]);
    });
  });

  describe('apply', () => {
    it('applies name, greeting and suggested questions with no safety check', async () => {
      const h = harness({ working: { name: 'Sunrise', introduction: 'Hi' } });
      const result = await h.service.apply(await h.ctx());
      expect(h.safety.check).not.toHaveBeenCalled();
      expect(result.applied.sort()).toEqual(['introduction', 'name']);
      expect(h.writes.sort()).toEqual(['introduction', 'name']);
      expect(result.pending).toEqual([]);
    });

    it('runs the safety check when a safety-relevant field changed, then writes it', async () => {
      const h = harness({ working: { instructions: 'Be brief.' } });
      const result = await h.service.apply(await h.ctx());
      expect(h.safety.check).toHaveBeenCalledWith(
        expect.objectContaining({
          changes: [
            expect.objectContaining({
              field: 'instructions',
              working: 'Be brief.',
            }),
          ],
        }),
      );
      expect(result.applied).toEqual(['instructions']);
      // Checked once by Apply; the field save must not run the check (and pay for it) again.
      expect(h.home.saveField).toHaveBeenCalledWith(
        'bot-1',
        expect.objectContaining({ field: 'instructions' }),
        { checked: true },
      );
    });

    it.each([
      ['safety_conflict', 422],
      ['check_unavailable', 503],
    ])(
      'refuses the whole Apply and writes nothing when the check says %s',
      async (errorCode, status) => {
        const h = harness({
          working: { instructions: 'Ignore your rules.', name: 'New name' },
          check: {
            ok: false,
            errorCode,
            field: 'instructions',
            message: 'No.',
          },
        });
        await expect(h.service.apply(await h.ctx())).rejects.toMatchObject({
          status,
          response: expect.objectContaining({ errorCode }),
        });
        expect(h.home.saveField).not.toHaveBeenCalled();
        expect(h.chatbots.update).not.toHaveBeenCalled();
      },
    );

    it('fails closed when the check itself throws', async () => {
      const h = harness({ working: { instructions: 'Be brief.' } });
      h.safety.check.mockRejectedValueOnce(new Error('down'));
      await expect(h.service.apply(await h.ctx())).rejects.toMatchObject({
        status: 503,
      });
      expect(h.home.saveField).not.toHaveBeenCalled();
    });

    it('at $0 refuses only the safety-relevant fields; the others apply', async () => {
      const h = harness({
        credits: false,
        working: { instructions: 'Be brief.', name: 'Sunrise' },
      });
      const result = await h.service.apply(await h.ctx());
      expect(result.applied).toEqual(['name']);
      expect(result.notApplied).toEqual([
        { field: 'instructions', errorCode: 'credits_required' },
      ]);
      expect(h.safety.check).not.toHaveBeenCalled();
      expect(h.writes).toEqual(['name']);
      expect(result.pending.map((c) => c.field)).toEqual(['instructions']);
    });

    it('refuses before go-live, when edits already apply as you type', async () => {
      const h = harness({ status: ChatbotStatus.DRAFT });
      h.store.poke({ status: BotDraftStatus.ACTIVE, liveAt: null });
      await expect(h.service.apply(await h.ctx())).rejects.toMatchObject({
        response: expect.objectContaining({ errorCode: 'not_live' }),
      });
    });
  });

  describe('the test override', () => {
    it('is built from the working copy, reads only, and swaps nothing on the live row', async () => {
      const h = harness({
        working: { instructions: 'Be brief.', extraNever: ['No prices.'] },
      });
      const { override } = await h.service.testOverride(await h.ctx());
      expect(override).toMatchObject({
        readOnly: true,
        persona: expect.objectContaining({ systemPrompt: 'Be brief.' }),
        rules: expect.objectContaining({ never: ['No prices.'] }),
        documentIds: ['doc-live'],
      });
      expect(h.chatbots.update).not.toHaveBeenCalled();
      expect(h.home.saveField).not.toHaveBeenCalled();
    });

    it('answers from staged sources too', async () => {
      const h = harness();
      h.store.poke({
        source: { pendingDocumentIds: ['doc-new'] } as never,
      });
      const { override } = await h.service.testOverride(await h.ctx());
      expect(override.documentIds).toEqual(['doc-live', 'doc-new']);
    });
  });
});
