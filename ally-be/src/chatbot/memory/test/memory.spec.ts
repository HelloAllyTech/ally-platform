import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { HOME_FIELDS } from '../../../bot-draft/home/home-fields';
import { WaHandledBy } from '../../../whatsapp/enum/whatsapp.enum';
import { MemorySection } from '../../entity/memory-entry.entity';
import { AgentRuntimeUsed, ChatbotMemberRole } from '../../enum/chatbot.enum';
import { InboxController } from '../../inbox/inbox.controller';
import { wouldRemember } from '../../service/chatbot.service';
import { MEMORY_BUDGET_CHARS, renderMemory } from '../memory-render';
import { expiryFor } from '../memory.service';
import {
  cleanOwnerNeverStore,
  matchesNeverStore,
  neverStoreList,
} from '../never-store';

jest.mock('src/common/execution/execution-manager', () => ({
  ExecutionManager: { getUserId: () => 7, getExecutionId: () => undefined },
}));

const DAY = 24 * 60 * 60 * 1000;

describe('never store', () => {
  it('every bot has the defaults; a health pack adds its own; the owner adds lines', () => {
    expect(neverStoreList('standard', ['Religion'])).toEqual([
      'Payment details',
      'Passwords and PINs',
      'ID numbers',
      'Religion',
    ]);
    expect(neverStoreList('mental_health', [])).toEqual([
      'Payment details',
      'Passwords and PINs',
      'ID numbers',
      'Symptoms',
      'Conditions',
      'Medicines',
      'Diagnoses',
    ]);
  });

  it("the defaults can't be removed, or saved again as the owner's", () => {
    expect(
      cleanOwnerNeverStore('medical', [' Medicines ', 'religion', 'Religion']),
    ).toEqual(['religion']);
    expect(() => cleanOwnerNeverStore(null, ['x'.repeat(81)])).toThrow();
    expect(() =>
      cleanOwnerNeverStore(
        null,
        Array.from({ length: 21 }, (_, i) => `line ${i}`),
      ),
    ).toThrow();
  });

  it.each([
    'card 4111 1111 1111 1111',
    'my password is hunter2',
    'gave her PIN',
    'Aadhaar 1234 5678 9012',
    'PAN ABCDE1234F',
  ])('refuses %s on every bot', (text) => {
    expect(matchesNeverStore(text, 'standard', [])).toBe(true);
  });

  it.each([
    'prefers evenings',
    'comes with his mother',
    'asked about the group class',
  ])('keeps %s, even on a health pack', (text) => {
    expect(matchesNeverStore(text, 'mental_health', [])).toBe(false);
  });

  it.each([
    'takes sertraline',
    'has anxiety',
    'was diagnosed last year',
    'on 50 mg a day',
  ])('refuses %s on a health pack only', (text) => {
    expect(matchesNeverStore(text, 'mental_health', [])).toBe(true);
    expect(matchesNeverStore(text, 'standard', [])).toBe(false);
  });

  it("matches an owner's line by its words, as the start of a word", () => {
    expect(matchesNeverStore('is religious', null, ['religion'])).toBe(true);
    expect(
      matchesNeverStore('family problems at home', null, ['family problems']),
    ).toBe(true);
    expect(
      matchesNeverStore('comes with family', null, ['family problems']),
    ).toBe(false);
  });
});

describe('renderMemory', () => {
  const at = (days: number) => new Date(Date.UTC(2026, 10, 14) - days * DAY);

  it('open items first, then preferences, then context; newest first; short ids in reading order', () => {
    const out = renderMemory(
      [
        {
          id: 'a',
          section: MemorySection.CONTEXT,
          text: 'comes with mother',
          saidAt: at(3),
        },
        {
          id: 'b',
          section: MemorySection.PREFERENCES,
          text: 'prefers evenings',
          saidAt: at(2),
        },
        {
          id: 'c',
          section: MemorySection.OPEN_ITEMS,
          text: 'waiting on fees',
          saidAt: at(1),
        },
        {
          id: 'd',
          section: MemorySection.PREFERENCES,
          text: 'prefers Hindi',
          saidAt: at(0),
        },
      ],
      { timeZone: 'UTC' },
    );
    expect(out.text).toBe(
      [
        'Still open:',
        '- m1 (13 Nov 2026): waiting on fees',
        'Preferences:',
        '- m2 (14 Nov 2026): prefers Hindi',
        '- m3 (12 Nov 2026): prefers evenings',
        'Context:',
        '- m4 (11 Nov 2026): comes with mother',
      ].join('\n'),
    );
    expect(out.refs).toEqual({ m1: 'c', m2: 'd', m3: 'b', m4: 'a' });
  });

  it('stays within its budget, dropping the oldest', () => {
    const lines = Array.from({ length: 40 }, (_, i) => ({
      id: `id${i}`,
      section: MemorySection.PREFERENCES,
      text: `preference number ${i} `.padEnd(120, '.'),
      saidAt: at(i),
    }));
    const out = renderMemory(lines);
    expect(out.text.length).toBeLessThanOrEqual(MEMORY_BUDGET_CHARS);
    expect(out.text).toContain('preference number 0 ');
    expect(out.text).not.toContain('preference number 39 ');
  });

  it('is empty with no lines', () => {
    expect(renderMemory([])).toEqual({ text: '', refs: {} });
  });
});

describe('expiryFor', () => {
  const said = new Date('2026-11-14T10:00:00Z');
  const days = (d: Date | null) =>
    d ? Math.round((d.getTime() - said.getTime()) / DAY) : null;

  it.each([
    [MemorySection.PREFERENCES, 180, 180],
    [MemorySection.PREFERENCES, 0, null],
    [MemorySection.OPEN_ITEMS, 180, 30],
    [MemorySection.OPEN_ITEMS, 10, 10],
    [MemorySection.CONTEXT, 365, 180],
    [MemorySection.CONTEXT, 0, 180],
  ])('%s with retention %d lasts %s days', (section, retention, expected) => {
    expect(days(expiryFor(section, said, retention))).toBe(expected);
  });
});

describe("Try it's would remember", () => {
  const agent = {
    runtime: AgentRuntimeUsed.V2 as const,
    runId: 'r',
    conversationId: 'preview-1',
    trace: [],
    memory: {
      writes: [
        {
          op: 'add' as const,
          section: 'preferences' as const,
          text: 'prefers evenings',
        },
        { op: 'name' as const, text: 'Rahul' },
        { op: 'forget' as const, id: 'm1' },
      ],
      refs: {},
    },
  };

  it('shows the lines it would add or change', () => {
    expect(wouldRemember({ agent, handledBy: WaHandledBy.RAG })).toEqual([
      'prefers evenings',
    ]);
  });

  it('shows nothing when the crisis reply went out instead', () => {
    expect(wouldRemember({ agent, handledBy: WaHandledBy.CRISIS })).toEqual([]);
  });
});

describe('the memory home field', () => {
  const state = (settings: Record<string, unknown>, safetyPack = 'medical') =>
    ({ chatbot: { settings, safetyPack } }) as never;

  it('reads off by default, with the defaults to show', () => {
    expect(HOME_FIELDS.memory.read(state({}))).toEqual({
      on: false,
      neverStore: [],
      defaults: neverStoreList('medical', []),
    });
  });

  it("writes the switch and the owner's own lines only", () => {
    const value = HOME_FIELDS.memory.parse({
      on: true,
      neverStore: ['Religion', 'Medicines'],
    });
    const write = HOME_FIELDS.memory.write(
      value,
      state({ handover: { x: 1 } }),
    );
    expect(write.chatbot?.settings).toEqual({
      handover: { x: 1 },
      memory: { on: true, neverStore: ['Religion'] },
    });
  });

  it('refuses a value that is not a choice', () => {
    expect(() => HOME_FIELDS.memory.parse({ on: 'yes' })).toThrow();
  });
});

describe('the Inbox memory routes', () => {
  const chatbot = {
    id: 'b0000000-0000-4000-8000-000000000001',
    settings: {},
    safetyPack: null,
  };
  const contact = 'c0000000-0000-4000-8000-000000000001';
  const entry = 'e0000000-0000-4000-8000-000000000001';

  function controller(role: ChatbotMemberRole, ownContact = true) {
    const access = {
      assert: jest.fn(async (_id: string, min: ChatbotMemberRole) => {
        const rank = { viewer: 0, editor: 1, owner: 2 } as const;
        if (rank[role] < rank[min]) throw new ForbiddenException();
        return { chatbot, role };
      }),
    };
    const memory = {
      contactOf: jest.fn().mockResolvedValue(ownContact),
      forInbox: jest
        .fn()
        .mockResolvedValue({ on: true, name: null, lines: [] }),
      forget: jest.fn().mockResolvedValue(true),
      edit: jest
        .fn()
        .mockResolvedValue({ ok: true, line: { id: entry, text: 'x' } }),
      forgetPerson: jest.fn().mockResolvedValue(2),
    };
    const c = new InboxController(
      {} as never,
      {} as never,
      {} as never,
      access as never,
      {} as never,
      memory as never,
    );
    return { c, access, memory };
  }

  it('viewers read', async () => {
    const { c, memory } = controller(ChatbotMemberRole.VIEWER);
    await expect(c.memoryOf(chatbot.id, contact)).resolves.toMatchObject({
      on: true,
    });
    expect(memory.forInbox).toHaveBeenCalledWith(chatbot, contact);
  });

  it("viewers can't forget, edit or forget a person", async () => {
    const { c, memory } = controller(ChatbotMemberRole.VIEWER);
    await expect(c.forgetLine(chatbot.id, entry)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(
      c.editLine(chatbot.id, entry, { text: 'x' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(c.forgetPerson(chatbot.id, contact)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(memory.forget).not.toHaveBeenCalled();
    expect(memory.edit).not.toHaveBeenCalled();
    expect(memory.forgetPerson).not.toHaveBeenCalled();
  });

  it('editors forget, edit and forget a person', async () => {
    const { c, memory } = controller(ChatbotMemberRole.EDITOR);
    await expect(c.forgetLine(chatbot.id, entry)).resolves.toEqual({
      forgotten: true,
    });
    await expect(c.editLine(chatbot.id, entry, { text: 'x' })).resolves.toEqual(
      {
        id: entry,
        text: 'x',
      },
    );
    await expect(c.forgetPerson(chatbot.id, contact)).resolves.toEqual({
      forgotten: 2,
    });
    expect(memory.forgetPerson).toHaveBeenCalledWith(chatbot.id, contact);
  });

  it("is a 404 for another bot's person, or a line that isn't there", async () => {
    const { c, memory } = controller(ChatbotMemberRole.OWNER, false);
    await expect(c.memoryOf(chatbot.id, contact)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    memory.forget.mockResolvedValue(false);
    await expect(c.forgetLine(chatbot.id, entry)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("an edit on the never-store list is refused with the owner's words", async () => {
    const { c, memory } = controller(ChatbotMemberRole.EDITOR);
    memory.edit.mockResolvedValue({ ok: false, reason: 'never_store' });
    await expect(
      c.editLine(chatbot.id, entry, { text: 'PIN 1234' }),
    ).rejects.toMatchObject({
      response: { code: 'never_store' },
    });
  });
});

describe('the run carries memory both ways', () => {
  const {
    AgentRuntimeRunner,
  } = require('../../engine/agent-runtime-runner.service');

  function runner(writes?: unknown[]) {
    const aiService = {
      runAgent: jest.fn().mockResolvedValue({
        intent: 'answer',
        answer: 'Evening slots: 18:00.',
        citations: [],
        retrieval: {},
        run_id: 'run-1',
        runtime: 'v2',
        trace: [],
        ...(writes ? { memory_writes: writes } : {}),
      }),
    };
    const memory = {
      forRun: jest.fn().mockResolvedValue({
        fields: {
          memory: {
            lines: 'Preferences:\n- m1 (12 Nov 2026): prefers evenings',
            never_store: [],
          },
          person_name: 'Rahul',
        },
        refs: { m1: 'line-1' },
      }),
    };
    const r = new AgentRuntimeRunner(
      {} as never,
      aiService as never,
      { find: jest.fn().mockResolvedValue([]) } as never,
      { servedFor: () => [] } as never,
      {} as never,
      {
        offeredFor: jest
          .fn()
          .mockResolvedValue({ definitions: [], omitted: [] }),
      } as never,
      memory as never,
    );
    return { r, aiService, memory };
  }
  const turn = {
    chatbot: { id: 'bot', settings: {} },
    settings: { declineText: '' },
    channel: { capabilities: {} },
    conversationId: 'c0000000-0000-4000-8000-000000000001',
    contactId: 'contact',
    providerMessageId: 'msg-1',
  };

  it("sends the person's lines and name, and keeps the writes with the ids it showed", async () => {
    const writes = [{ op: 'forget', id: 'm1' }];
    const { r, aiService } = runner(writes);
    const answered = await r.answer(
      turn as never,
      { question: 'hi' } as never,
      {},
    );
    const body = aiService.runAgent.mock.calls[0][0];
    expect(body.memory.lines).toContain('prefers evenings');
    expect(body.person_name).toBe('Rahul');
    expect(answered.agent.memory).toEqual({ writes, refs: { m1: 'line-1' } });
    expect(answered.response).not.toHaveProperty('memory_writes');
  });

  it('keeps no memory on the run when it asked for none', async () => {
    const { r } = runner();
    const answered = await r.answer(
      turn as never,
      { question: 'hi' } as never,
      {},
    );
    expect(answered.agent).not.toHaveProperty('memory');
  });
});
