import { ConflictException } from '@nestjs/common';
import { BotDraftStatus } from '../enum/bot-draft.enum';
import {
  BLANK_STARTER_REPLY,
  BotDraftPreviewService,
  PREVIEW_INDEX_WAIT,
} from '../service/bot-draft-preview.service';

const draft = (over: Record<string, unknown> = {}) =>
  ({
    id: 'draft-1',
    chatbotId: 'bot-1',
    status: BotDraftStatus.ACTIVE,
    ...over,
  }) as never;

function harness(
  over: {
    draft?: unknown;
    pending?: number | Error;
    /** Statuses of the notes/facts documents on each successive check; the last repeats. */
    docStatuses?: string[][];
    source?: Record<string, string | null>;
    stage?: () => Promise<unknown>;
  } = {},
) {
  const calls: string[] = [];
  const base = over.draft ?? draft();
  const withSource = over.source
    ? ({ ...(base as object), source: over.source } as never)
    : base;
  const drafts = { get: jest.fn(async () => withSource) };
  let check = 0;
  const publisher = {
    stage: jest.fn(async () => {
      calls.push('stage');
      await over.stage?.();
    }),
  };
  const chatbots = {
    test: jest.fn(async () => {
      calls.push('test');
      return { reply: 'Hello', handledBy: 'rag', citations: [] };
    }),
  };
  const access = { assert: jest.fn(async () => ({})) };
  const documents = {
    manager: {
      query: jest.fn(async (sql: string) => {
        if (sql.includes('ANY($1)')) {
          const all = over.docStatuses ?? [['indexed']];
          const step = all[Math.min(check, all.length - 1)];
          check += 1;
          return step.map((status) => ({ status }));
        }
        if (over.pending instanceof Error) throw over.pending;
        return [{ pending: String(over.pending ?? 0) }];
      }),
    },
  };
  const service = new BotDraftPreviewService(
    drafts as never,
    publisher as never,
    chatbots as never,
    access as never,
    documents as never,
  );
  return { service, drafts, publisher, chatbots, access, documents, calls };
}

describe('BotDraftPreviewService', () => {
  it('projects the draft onto its assistant, then runs the ordinary test', async () => {
    const h = harness();
    const result = await h.service.test('draft-1', { message: 'Hi' } as never);
    expect(h.calls).toEqual(['stage', 'test']);
    expect(h.chatbots.test).toHaveBeenCalledWith(
      'bot-1',
      expect.objectContaining({ message: 'Hi' }),
      undefined,
    );
    expect(result.reply).toBe('Hello');
  });

  it('checks the caller can edit the assistant before projecting anything', async () => {
    const h = harness();
    await h.service.test('draft-1', { message: 'Hi' } as never);
    expect(h.access.assert).toHaveBeenCalledWith('bot-1', expect.anything());
    expect(h.access.assert.mock.invocationCallOrder[0]).toBeLessThan(
      h.publisher.stage.mock.invocationCallOrder[0],
    );
  });

  it('ignores an override sent from the browser: the server draft is the truth', async () => {
    const h = harness();
    await h.service.test('draft-1', {
      message: 'Hi',
      draft: { settings: { crisisClassifierEnabled: false } },
    } as never);
    const sent = (h.chatbots.test.mock.calls[0] as unknown[])[1] as {
      draft?: unknown;
    };
    expect(sent.draft).toBeUndefined();
  });

  it('passes the live stream through to the test', async () => {
    const h = harness();
    const live = { onEvent: jest.fn() };
    await h.service.test('draft-1', { message: 'Hi' } as never, live);
    expect((h.chatbots.test.mock.calls[0] as unknown[])[2]).toBe(live);
  });

  it.each([BotDraftStatus.PUBLISHED, BotDraftStatus.ABANDONED])(
    'refuses a %s setup, so it never overwrites edits made from the home',
    async (status) => {
      const h = harness({ draft: draft({ status }) });
      await expect(
        h.service.test('draft-1', { message: 'Hi' } as never),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ errorCode: 'setup_finished' }),
      });
      expect(h.publisher.stage).not.toHaveBeenCalled();
      expect(h.chatbots.test).not.toHaveBeenCalled();
    },
  );

  it('refuses a draft with no assistant yet', async () => {
    const h = harness({ draft: draft({ chatbotId: null }) });
    await expect(
      h.service.test('draft-1', { message: 'Hi' } as never),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(h.chatbots.test).not.toHaveBeenCalled();
  });

  it('reports how many documents are still being indexed', async () => {
    const h = harness({ pending: 3 });
    const result = await h.service.test('draft-1', { message: 'Hi' } as never);
    expect(result.preview).toMatchObject({
      pendingDocuments: 3,
      editsSearchable: true,
    });
  });

  it('never fails a test because the pending count failed', async () => {
    const h = harness({ pending: new Error('db down') });
    const result = await h.service.test('draft-1', { message: 'Hi' } as never);
    expect(result.preview).toMatchObject({
      pendingDocuments: 0,
      editsSearchable: true,
    });
  });

  it('runs one projection at a time per draft, so notes are never created twice', async () => {
    let running = 0;
    let peak = 0;
    const h = harness({
      stage: async () => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 10));
        running -= 1;
      },
    });
    await Promise.all([
      h.service.test('draft-1', { message: 'a' } as never),
      h.service.test('draft-1', { message: 'b' } as never),
      h.service.test('draft-1', { message: 'c' } as never),
    ]);
    expect(peak).toBe(1);
    expect(h.publisher.stage).toHaveBeenCalledTimes(3);
  });

  it('does not let one failed projection block the next test', async () => {
    const h = harness();
    h.publisher.stage.mockRejectedValueOnce(new Error('boom'));
    await expect(
      h.service.test('draft-1', { message: 'a' } as never),
    ).rejects.toThrow('boom');
    await expect(
      h.service.test('draft-1', { message: 'b' } as never),
    ).resolves.toMatchObject({ reply: 'Hello' });
  });

  describe('waiting for an edit to be searchable', () => {
    const original = { ...PREVIEW_INDEX_WAIT };
    beforeEach(() => {
      PREVIEW_INDEX_WAIT.maxMs = 200;
      PREVIEW_INDEX_WAIT.pollMs = 10;
    });
    afterEach(() => Object.assign(PREVIEW_INDEX_WAIT, original));

    const source = {
      ownerNotesDocumentId: 'doc-1',
      learnedFactsDocumentId: null,
    };

    it('waits for a re-indexing notes document, then tests', async () => {
      const h = harness({
        source,
        docStatuses: [['pending'], ['pending'], ['indexed']],
      });
      const result = await h.service.test('draft-1', {
        message: 'Hi',
      } as never);
      expect(result.preview.editsSearchable).toBe(true);
      expect(h.documents.manager.query).toHaveBeenCalledWith(
        expect.stringContaining('ANY($1)'),
        [['doc-1']],
      );
    });

    it('still tests, and says so, when indexing outlasts the wait', async () => {
      const h = harness({ source, docStatuses: [['pending']] });
      const result = await h.service.test('draft-1', {
        message: 'Hi',
      } as never);
      expect(h.chatbots.test).toHaveBeenCalled();
      expect(result.preview.editsSearchable).toBe(false);
    });

    it('waits for nothing when there are no notes or facts documents', async () => {
      const h = harness();
      const result = await h.service.test('draft-1', {
        message: 'Hi',
      } as never);
      expect(result.preview.editsSearchable).toBe(true);
    });

    it('never fails a test because the wait failed', async () => {
      const h = harness({ source });
      h.documents.manager.query.mockImplementation(async (sql: string) => {
        if (sql.includes('ANY($1)')) throw new Error('db down');
        return [{ pending: '0' }];
      });
      const result = await h.service.test('draft-1', {
        message: 'Hi',
      } as never);
      expect(result.preview.editsSearchable).toBe(true);
    });
  });

  describe('stage 3: the working copy', () => {
    function live(
      over: { draft?: Record<string, unknown>; crisis?: boolean | Error } = {},
    ) {
      const calls: string[] = [];
      const row = draft({
        status: BotDraftStatus.PUBLISHED,
        liveAt: new Date(),
        draftConfig: { instructions: 'Be brief.', knowledgeDocumentIds: [] },
        source: {},
        ...over.draft,
      });
      const drafts = {
        get: jest.fn(async () => row),
        touch: jest.fn(async () => undefined),
      };
      const publisher = { stage: jest.fn(async () => calls.push('stage')) };
      const chatbots = {
        test: jest.fn(async () => {
          calls.push('test');
          return { reply: 'Hello', handledBy: 'rag', citations: [] };
        }),
      };
      const chatbot = { id: 'bot-1', status: 'live' };
      const access = { assert: jest.fn(async () => ({ chatbot })) };
      const documents = {
        manager: { query: jest.fn(async () => [{ pending: '0' }]) },
      };
      const override = {
        readOnly: true,
        persona: { systemPrompt: 'Be brief.' },
        documentIds: ['doc-1'],
      };
      const workingCopy = {
        testOverride: jest.fn(async () => ({
          override,
          waitFor: [],
          draft: row,
        })),
      };
      const replies = {
        isCrisisKeyword: jest.fn(async () => {
          if (over.crisis instanceof Error) throw over.crisis;
          return over.crisis ?? false;
        }),
      };
      const service = new BotDraftPreviewService(
        drafts as never,
        publisher as never,
        chatbots as never,
        access as never,
        documents as never,
        workingCopy as never,
        replies as never,
      );
      return {
        service,
        publisher,
        chatbots,
        workingCopy,
        drafts,
        replies,
        override,
        calls,
      };
    }

    it('never writes the live chatbot: the test runs the working copy as a server-side override', async () => {
      const h = live();
      const result = await h.service.test('draft-1', {
        message: 'Hi',
        draft: { persona: { systemPrompt: 'from the browser' } },
      } as never);
      expect(h.publisher.stage).not.toHaveBeenCalled();
      expect(h.chatbots.test).toHaveBeenCalledWith(
        'bot-1',
        expect.objectContaining({ message: 'Hi', draft: undefined }),
        undefined,
        h.override,
      );
      expect(result.preview).toMatchObject({
        workingCopy: true,
        starter: false,
      });
      expect(result.preview.settingsHash).toMatch(/^[0-9a-f]{16}$/);
    });

    it('still projects onto the chatbot before it has ever gone live', async () => {
      const h = live({
        draft: { status: BotDraftStatus.ACTIVE, liveAt: null },
      });
      (h.chatbots as unknown as { test: jest.Mock }).test.mockClear();
      const access = await (
        h.service as unknown as {
          access: { assert: jest.Mock };
        }
      ).access.assert.mockResolvedValue({
        chatbot: { id: 'bot-1', status: 'draft' },
      });
      void access;
      await h.service.test('draft-1', { message: 'Hi' } as never);
      expect(h.calls).toEqual(['stage', 'test']);
      expect(h.workingCopy.testOverride).not.toHaveBeenCalled();
    });

    it('answers a blank chatbot with the canned starter reply and no model call', async () => {
      const h = live({
        draft: {
          status: BotDraftStatus.ACTIVE,
          liveAt: null,
          blank: true,
          draftConfig: {
            instructions: '',
            ownerNotes: '',
            knowledgeDocumentIds: [],
          },
          learned: { facts: [] },
        },
      });
      const result = await h.service.test('draft-1', {
        message: 'What do you do?',
      } as never);
      expect(result.reply).toBe(BLANK_STARTER_REPLY);
      expect(result.preview.starter).toBe(true);
      expect(h.chatbots.test).not.toHaveBeenCalled();
      expect(h.drafts.touch).toHaveBeenCalledWith('draft-1');
    });

    it.each([
      ['matches a crisis keyword', true],
      ['cannot be checked for a crisis keyword', new Error('down')],
    ])(
      'sends a blank chatbot’s message through the engine when it %s',
      async (_label, crisis) => {
        const h = live({
          crisis,
          draft: {
            status: BotDraftStatus.ACTIVE,
            liveAt: null,
            blank: true,
            draftConfig: { instructions: '', knowledgeDocumentIds: [] },
            learned: { facts: [] },
          },
        });
        await (
          h.service as unknown as { access: { assert: jest.Mock } }
        ).access.assert.mockResolvedValue({
          chatbot: { id: 'bot-1', status: 'draft' },
        });
        await h.service.test('draft-1', {
          message: 'I want to end it all',
        } as never);
        expect(h.chatbots.test).toHaveBeenCalled();
      },
    );
  });
});
