import { BadRequestException, ConflictException } from '@nestjs/common';
import { BotDraftStatus } from '../enum/bot-draft.enum';
import { usageContext } from '../../billing/context/usage-context';
import {
  DraftChangeService,
  languagesAfter,
} from '../service/draft-change.service';
import { fieldVersion } from '../working-copy/staged-fields';
import { memoryDrafts } from './memory-drafts';

jest.mock('src/common/execution/execution-manager', () => ({
  ExecutionManager: {
    getUserId: () => 7,
    getTenantId: () => 'tenant-1',
    getExecutionId: () => undefined,
  },
}));

function harness(
  over: {
    row?: Parameters<typeof memoryDrafts>[0];
    proposed?: Record<string, unknown>;
  } = {},
) {
  const store = memoryDrafts(over.row);
  const ai = {
    proposeChange: jest.fn(async () => ({
      refused: false,
      reply: 'Here is the change.',
      changes: [],
      ...over.proposed,
    })),
    getPromptOverrides: jest.fn(async () => ({})),
  };
  const access = {
    assert: jest.fn(async () => ({ chatbot: { createdBy: 7 } })),
  };
  const limits = { assertOwnerRun: jest.fn(async () => undefined) };
  const service = new DraftChangeService(
    store.service,
    ai as never,
    access as never,
    limits as never,
  );
  const patchSpy = jest.spyOn(store.service, 'applyPatch');
  return { service, store, ai, access, limits, patchSpy };
}

describe('DraftChangeService', () => {
  describe('propose', () => {
    it('builds "current" from the draft, not the assistant row, and spends an owner run', async () => {
      const h = harness();
      const before = h.store.row();
      await h.service.propose('draft-1', 'be more formal');
      expect(h.limits.assertOwnerRun).toHaveBeenCalledTimes(1);
      const sent = (h.ai.proposeChange.mock.calls[0] as unknown[])[0] as {
        request: string;
        current: Record<string, unknown>;
      };
      expect(sent.request).toBe('be more formal');
      expect(sent.current).toMatchObject({
        assistant_name: before.draftConfig.assistantName,
        tone: before.draftConfig.tone,
        language: 'en',
        own_rules: [],
      });
    });

    it('returns the draft version and only changes the draft can take', async () => {
      const h = harness({
        proposed: {
          changes: [
            { field: 'tone', before: 'warm', after: 'formal' },
            { field: 'safety_pack', after: 'none' },
          ],
        },
      });
      const out = await h.service.propose('draft-1', 'x');
      expect(out.version).toBe(1);
      expect(out.refused).toBe(false);
      expect(out.changes.map((c) => c.field)).toEqual(['tone']);
    });

    it('surfaces a safety-weakening request as the same fixed refusal', async () => {
      const h = harness({ proposed: { refused: true, reply: 'secret' } });
      const out = await h.service.propose('draft-1', 'drop the safety rules');
      expect(out.refused).toBe(true);
      expect(out.changes).toEqual([]);
      expect(out.message).not.toBe('secret');
      expect(out.message.length).toBeGreaterThan(0);
    });

    it('stage 3: keeps the request and Copilot’s reply on the draft (a reload restores them), without a version bump', async () => {
      const h = harness();
      const lines = jest.spyOn(h.store.service, 'appendTranscriptLines');
      const out = await h.service.propose('draft-1', 'be more formal');
      expect(lines).toHaveBeenCalledWith('draft-1', [
        { role: 'owner', text: 'be more formal', kind: 'copilot' },
        { role: 'builder', text: 'Here is the change.', kind: 'copilot' },
      ]);
      // The version Apply sends back is unchanged by the chat lines.
      expect(out.version).toBe(1);
      const [sql, params] = (
        h.store.service as unknown as {
          dataSource: { query: jest.Mock };
        }
      ).dataSource.query.mock.calls.slice(-1)[0];
      expect(sql).toContain('UPDATE bot_drafts SET transcript');
      expect(sql).not.toContain('version');
      expect(JSON.parse(params[1] as string)).toHaveLength(2);
    });

    it('stage 3: a refusal is kept as the fixed refusal, and a failed write never fails the proposal', async () => {
      const h = harness({ proposed: { refused: true, reply: 'secret' } });
      const lines = jest
        .spyOn(h.store.service, 'appendTranscriptLines')
        .mockRejectedValue(new Error('db down'));
      const out = await h.service.propose('draft-1', 'drop the rules');
      expect(out.refused).toBe(true);
      const kept = lines.mock.calls[0][1];
      expect(kept[1].text).toBe(out.message);
      expect(JSON.stringify(kept)).not.toContain('secret');
    });

    it('refuses an abandoned setup', async () => {
      const h = harness({ row: { status: BotDraftStatus.ABANDONED } });
      await expect(h.service.propose('draft-1', 'x')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(h.ai.proposeChange).not.toHaveBeenCalled();
    });

    it("proposes on a published setup: it is the live chatbot's working copy (stage 3)", async () => {
      const h = harness({ row: { status: BotDraftStatus.PUBLISHED } });
      await expect(h.service.propose('draft-1', 'x')).resolves.toMatchObject({
        refused: false,
      });
    });

    it('refuses with credits_required at $0, before any model call', async () => {
      const h = harness();
      const service = new DraftChangeService(
        h.store.service,
        h.ai as never,
        h.access as never,
        h.limits as never,
        { creditsAvailable: async () => false },
      );
      await expect(service.propose('draft-1', 'x')).rejects.toMatchObject({
        status: 402,
        response: expect.objectContaining({ errorCode: 'credits_required' }),
      });
      expect(h.ai.proposeChange).not.toHaveBeenCalled();
    });

    it('meters the call as a change by chat for this chatbot and draft', async () => {
      const h = harness();
      let seen: unknown;
      h.ai.proposeChange.mockImplementationOnce(async () => {
        seen = usageContext.current();
        return { refused: false, reply: 'ok', changes: [] };
      });
      await h.service.propose('draft-1', 'x');
      expect(seen).toMatchObject({
        runKind: 'change_by_chat',
        channel: 'owner',
        chatbotId: 'bot-1',
        draftId: 'draft-1',
        creatorUserId: 7,
      });
    });

    it('returns the version of each field the proposal touches', async () => {
      const h = harness({
        proposed: {
          changes: [
            { field: 'tone', before: 'warm', after: 'formal' },
            { field: 'language', after: 'hi' },
          ],
        },
      });
      const out = await h.service.propose('draft-1', 'x');
      expect(Object.keys(out.fieldVersions).sort()).toEqual([
        'languages',
        'tone',
      ]);
      expect(out.fieldVersions.tone).toBe(fieldVersion('warm'));
    });
  });

  describe('languages are a list', () => {
    it.each([
      [
        'one tag goes first and keeps the others',
        'hi',
        ['en', 'ta'],
        ['hi', 'en', 'ta'],
      ],
      ['a list replaces them', ['ta', 'hi'], ['en'], ['ta', 'hi']],
      ['"en, hi" replaces them', 'en, hi', ['ta'], ['en', 'hi']],
      ['"Hindi and English" tags only', 'hi and en', [], ['hi', 'en']],
      ['drops what is not a tag', ['en', 'not a tag!', 'en'], [], ['en']],
    ])('%s', (_label, after, current, expected) => {
      expect(languagesAfter(after, current as string[])).toEqual(expected);
    });
  });

  describe('apply', () => {
    it('writes each mapped field to the draft as one change', async () => {
      const h = harness();
      const lines = jest.spyOn(h.store.service, 'appendTranscriptLines');
      const out = await h.service.apply(
        'draft-1',
        [
          { field: 'assistant_name', before: 'x', after: 'Sunny' },
          { field: 'tone', before: 'warm', after: 'formal' },
          { field: 'language', before: 'en', after: 'hi' },
          {
            field: 'suggested_questions',
            before: [],
            after: ['What do sessions cost?'],
          },
          { field: 'add_rule', after: 'Never promise a cure.' },
          { field: 'avoid_topic', after: 'politics' },
        ],
        1,
      );
      const c = h.store.row().draftConfig;
      expect(c.assistantName).toBe('Sunny');
      expect(c.tone).toBe('formal');
      // Stage 3: one tag becomes the first language; the others are kept.
      expect(c.languages).toEqual(['hi', 'en']);
      expect(c.suggestedQuestions).toEqual(['What do sessions cost?']);
      expect(c.extraNever).toEqual([
        'Never promise a cure.',
        "Don't talk about politics.",
      ]);
      expect(h.patchSpy).toHaveBeenCalledTimes(1);
      expect(h.patchSpy.mock.calls[0][2]).toBe('owner');
      // Stage 3: the chat keeps a line saying what was applied.
      expect(lines).toHaveBeenCalledWith('draft-1', [
        expect.objectContaining({ role: 'note', kind: 'copilot' }),
      ]);
      expect(h.store.row().events.map((e) => e.id)).toContain(out.eventId);
    });

    it('409 stale_version when the draft moved since the proposal', async () => {
      const h = harness();
      await expect(
        h.service.apply(
          'draft-1',
          [{ field: 'tone', after: 'formal' }],
          0, // proposed against an older version
        ),
      ).rejects.toMatchObject({ response: { errorCode: 'stale_version' } });
      expect(h.store.row().draftConfig.tone).not.toBe('formal');
    });

    it('refuses a field outside the mapping with a 400 and applies nothing', async () => {
      const h = harness();
      for (const field of [
        'safety_pack',
        'safetyPackId',
        'access',
        'knowledgeDocumentIds',
        'ownerNotes',
        'name',
      ]) {
        await expect(
          h.service.apply(
            'draft-1',
            [
              { field: 'tone', after: 'formal' },
              { field, after: 'x' },
            ],
            1,
          ),
        ).rejects.toBeInstanceOf(BadRequestException);
      }
      expect(h.patchSpy).not.toHaveBeenCalled();
      expect(h.store.row().version).toBe(1);
    });

    it('answers too_many_rules past 20 own rules', async () => {
      const h = harness();
      const rules = Array.from({ length: 20 }, (_, i) => `Rule ${i}.`);
      await h.service.apply(
        'draft-1',
        rules.map((after) => ({ field: 'add_rule', after })),
        1,
      );
      await expect(
        h.service.apply(
          'draft-1',
          [{ field: 'avoid_topic', after: 'anything' }],
          h.store.row().version,
        ),
      ).rejects.toMatchObject({ response: { errorCode: 'too_many_rules' } });
      expect(h.store.row().draftConfig.extraNever).toHaveLength(20);
    });

    it('answers too_many_rules when one proposal would pass 20', async () => {
      const h = harness();
      const rules = Array.from({ length: 21 }, (_, i) => `Rule ${i}.`);
      await expect(
        h.service.apply(
          'draft-1',
          rules.map((after) => ({ field: 'add_rule', after })),
          1,
        ),
      ).rejects.toMatchObject({ response: { errorCode: 'too_many_rules' } });
      expect(h.patchSpy).not.toHaveBeenCalled();
    });

    it('refuses a rule over 200 characters', async () => {
      const h = harness();
      await expect(
        h.service.apply(
          'draft-1',
          [{ field: 'add_rule', after: 'x'.repeat(201) }],
          1,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses an invalid value through the draft checks (tone)', async () => {
      const h = harness();
      await expect(
        h.service.apply('draft-1', [{ field: 'tone', after: 'sarcastic' }], 1),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(h.store.row().draftConfig.tone).toBe('warm');
    });

    it('refuses an abandoned setup', async () => {
      const h = harness({ row: { status: BotDraftStatus.ABANDONED } });
      await expect(
        h.service.apply('draft-1', [{ field: 'tone', after: 'formal' }], 1),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('with field versions, an edit to another field never makes it stale', async () => {
      const h = harness();
      // Another tab edited the introduction: the draft version moved on.
      h.store.poke({ version: 5 });
      const out = await h.service.apply(
        'draft-1',
        [{ field: 'tone', after: 'formal' }],
        undefined,
        { tone: fieldVersion('warm') },
      );
      expect(out.version).toBe(6);
      expect(h.store.row().draftConfig.tone).toBe('formal');
    });

    it('with field versions, a stale field is refused with its current value', async () => {
      const h = harness();
      await expect(
        h.service.apply(
          'draft-1',
          [{ field: 'tone', after: 'formal' }],
          undefined,
          { tone: fieldVersion('friendly') },
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          errorCode: 'stale_field',
          details: {
            field: 'tone',
            value: 'warm',
            version: fieldVersion('warm'),
          },
        }),
      });
      expect(h.store.row().draftConfig.tone).toBe('warm');
    });
  });

  describe('undo', () => {
    it('takes back what apply returned the event id for', async () => {
      const h = harness();
      const { eventId, version } = await h.service.apply(
        'draft-1',
        [{ field: 'assistant_name', after: 'Sunny' }],
        1,
      );
      expect(version).toBe(h.store.row().version);
      const undone = await h.service.undo('draft-1', eventId);
      expect(h.store.row().draftConfig.assistantName).not.toBe('Sunny');
      expect(h.store.row().events.find((e) => e.id === eventId)?.undoneBy).toBe(
        undone.eventId,
      );
    });

    it('refuses when a later change touched the same thing, keeping that change', async () => {
      const h = harness();
      const first = await h.service.apply(
        'draft-1',
        [{ field: 'assistant_name', after: 'Sunny' }],
        1,
      );
      await h.service.apply(
        'draft-1',
        [{ field: 'assistant_name', after: 'Dawn' }],
        first.version,
      );
      await expect(
        h.service.undo('draft-1', first.eventId),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(h.store.row().draftConfig.assistantName).toBe('Dawn');
    });

    it('404 for an event that is not the owner’s', async () => {
      const h = harness();
      await expect(
        h.service.undo('draft-1', '00000000-0000-4000-8000-000000000000'),
      ).rejects.toMatchObject({ status: 404 });
    });
  });
});
