import { ConflictException } from '@nestjs/common';
import { LoggerService } from '../../../logger/logger.service';
import { WaHandledBy } from '../../../whatsapp/enum/whatsapp.enum';
import { DEFAULT_WHATSAPP_SETTINGS } from '../../../whatsapp/type/whatsapp-settings.type';
import { ConversationMessageRole } from '../../enum/conversation.enum';
import { HandoverService, WHATSAPP_SEND_EVENT } from '../handover.service';

const BOT_FIELDS = {
  id: 'bot-1',
  name: 'Sunrise Mind',
  settings: {},
  safetyPack: null,
};
const BOT = BOT_FIELDS as never;
const CHAT = 'conv-1';

/**
 * A fake `query`: each test says what the next rows are by the SQL they belong to. UPDATE …
 * RETURNING comes back as Postgres does through `query`: [rows, count].
 */
function harness(
  over: {
    holderId?: number | null;
    channel?: string;
    lastInbound?: Date | null;
  } = {},
) {
  let holder = over.holderId ?? null;
  const calls: [string, unknown[]][] = [];
  const query = jest.fn(
    async (sql: string, params: unknown[] = []): Promise<unknown> => {
      calls.push([sql, params]);
      if (sql.includes('SET handled_by_user_id = $3')) {
        if (holder !== null) return [[], 0];
        holder = params[2] as number;
        return [[{ id: CHAT }], 1];
      }
      if (sql.includes('SET handled_by_user_id = NULL') && sql.includes('$4')) {
        if (holder === null || (holder !== params[2] && !params[3]))
          return [[], 0];
        holder = null;
        return [[{ id: CHAT }], 1];
      }
      if (sql.includes('JOIN users u ON u.id = c.handled_by_user_id')) {
        return holder === null ? [] : [{ id: holder, name: 'Ravi Kumar' }];
      }
      if (sql.includes('SELECT id, chatbot_id, channel, handled_by_user_id')) {
        return [
          {
            id: CHAT,
            chatbot_id: 'bot-1',
            channel: over.channel ?? 'web',
            handled_by_user_id: holder,
          },
        ];
      }
      if (sql.includes('MAX("createdAt")'))
        return [{ at: over.lastInbound ?? null }];
      if (sql.includes("direction = 'outbound'") && sql.includes('LIMIT 1')) {
        return [{ handled_by: 'declined' }];
      }
      return [];
    },
  );
  const appendMessage = jest.fn(
    async (_id: string, m: Record<string, unknown>) => ({
      id: 'msg-9',
      createdAt: new Date('2026-11-12T10:00:00Z'),
      ...m,
    }),
  );
  const events = {
    publishInbox: jest.fn(),
    publishVisitor: jest.fn(),
  };
  const emitter = {
    emitAsync: jest.fn(async () => [{ messageId: 'wa-1', sent: true }]),
  };
  const email = { sendHandoverAlert: jest.fn().mockResolvedValue(true) };
  const crisis = {
    flag: jest.fn().mockResolvedValue(undefined),
    markTaken: jest.fn().mockResolvedValue(undefined),
    recipientEmails: jest.fn().mockResolvedValue(['owner@clinic.example']),
  };
  const outbox = { enqueue: jest.fn().mockResolvedValue(true) };
  const service = new HandoverService(
    { query } as never,
    { appendMessage, setMetadata: jest.fn() } as never,
    events as never,
    {
      getForChatbot: jest.fn().mockResolvedValue(DEFAULT_WHATSAPP_SETTINGS),
    } as never,
    emitter as never,
    email as never,
    { adminBaseUrl: 'https://admin.example' } as never,
    crisis as never,
    outbox as never,
  );
  return {
    crisis,
    outbox,
    service,
    query,
    calls,
    appendMessage,
    events,
    emitter,
    email,
    holder: () => holder,
  };
}

describe('HandoverService', () => {
  describe('after a decision', () => {
    it('a crisis reply marks the chat Safety and tells the inbox', async () => {
      const h = harness();
      const decision = { handledBy: WaHandledBy.CRISIS, body: 'Crisis line' };
      await expect(h.service.afterDecision(BOT, CHAT, decision)).resolves.toBe(
        decision,
      );
      expect(
        h.calls.some(([sql]) => sql.includes('SET safety_at = now()')),
      ).toBe(true);
      expect(h.events.publishInbox).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'safety', conversationId: CHAT }),
      );
      // Never a hand-over for a crisis.
      expect(
        h.calls.some(([sql]) => sql.includes('needs_person_since = COALESCE')),
      ).toBe(false);
    });

    it('a request for a person marks Needs a person', async () => {
      const h = harness();
      await h.service.afterDecision(BOT, CHAT, {
        handledBy: WaHandledBy.HANDOVER,
        body: 'x',
        handover: 'asked',
      });
      const mark = h.calls.find(([sql]) =>
        sql.includes('needs_person_since = COALESCE'),
      );
      expect(mark?.[1]).toEqual([CHAT, 'asked']);
    });

    it('a second "I don\'t know" in a row becomes the hand-over message', async () => {
      const h = harness();
      const out = await h.service.afterDecision(
        {
          ...BOT_FIELDS,
          settings: { abilities: { hand_over: 'do_it' } },
        } as never,
        CHAT,
        { handledBy: WaHandledBy.DECLINED, body: "I don't have that." },
        new Date('2026-11-12T10:00:00Z'),
      );
      expect(out.handledBy).toBe(WaHandledBy.HANDOVER);
      expect(out.body).toBe(
        "I've asked the team to join. They usually reply within a few hours.",
      );
      const mark = h.calls.find(([sql]) =>
        sql.includes('needs_person_since = COALESCE'),
      );
      expect(mark?.[1]).toEqual([CHAT, 'declined_twice']);
    });

    it.each([
      ['off', { abilities: { hand_over: 'never' } }],
      ['never set', {}],
    ])(
      'with hand-over %s, a second "I don\'t know" stays the reply and nobody is asked (Q3-fast, F2)',
      async (_label, settings) => {
        const h = harness();
        const decision = {
          handledBy: WaHandledBy.DECLINED,
          body: "I don't have that.",
        };
        const out = await h.service.afterDecision(
          { ...BOT_FIELDS, settings } as never,
          CHAT,
          decision,
        );
        expect(out).toEqual(decision);
        expect(
          h.calls.some(([sql]) =>
            sql.includes('needs_person_since = COALESCE'),
          ),
        ).toBe(false);
      },
    );
  });

  describe('taking over and handing back', () => {
    it('the first take-over wins; the second is told who has it', async () => {
      const h = harness();
      await expect(h.service.takeOver('bot-1', CHAT, 7)).resolves.toEqual({
        ok: true,
      });
      await expect(h.service.takeOver('bot-1', CHAT, 8)).rejects.toMatchObject({
        response: {
          errorCode: 'held_by_other',
          message: 'Ravi Kumar is replying in this chat.',
        },
      });
      expect(h.holder()).toBe(7);
      expect(h.events.publishVisitor).toHaveBeenCalledWith(CHAT, {
        type: 'state',
        by: 'person',
      });
    });

    it('only the person replying (or an owner) hands back', async () => {
      const h = harness({ holderId: 7 });
      await expect(h.service.handBack('bot-1', CHAT, 8)).rejects.toBeInstanceOf(
        ConflictException,
      );
      await expect(h.service.handBack('bot-1', CHAT, 8, true)).resolves.toEqual(
        { ok: true },
      );
      expect(h.holder()).toBeNull();
      expect(h.events.publishVisitor).toHaveBeenLastCalledWith(CHAT, {
        type: 'state',
        by: 'assistant',
      });
    });
  });

  describe('a team member replying', () => {
    const asha = { id: 7, name: 'Asha Rao' };

    it('on the bot page: stored as agent_human with the sender, and pushed to the visitor', async () => {
      const h = harness({ holderId: 7 });
      await h.service.reply(BOT, CHAT, asha, ' Happy to help. ');
      expect(h.appendMessage).toHaveBeenCalledWith(
        CHAT,
        expect.objectContaining({
          role: ConversationMessageRole.AGENT_HUMAN,
          handledBy: WaHandledBy.HUMAN,
          sentByUserId: 7,
          text: 'Happy to help.',
          retrievalMeta: { sender_label: 'Asha from Sunrise Mind' },
        }),
      );
      expect(h.events.publishVisitor).toHaveBeenCalledWith(
        CHAT,
        expect.objectContaining({
          type: 'message',
          sender: 'Asha from Sunrise Mind',
        }),
      );
      expect(h.emitter.emitAsync).not.toHaveBeenCalled();
    });

    it('on WhatsApp: sent through the bot number, signed, within 24 hours', async () => {
      const h = harness({
        holderId: 7,
        channel: 'whatsapp',
        lastInbound: new Date('2026-11-12T09:00:00Z'),
      });
      await h.service.reply(
        BOT,
        CHAT,
        asha,
        'Happy to help.',
        new Date('2026-11-12T10:00:00Z'),
      );
      expect(h.emitter.emitAsync).toHaveBeenCalledWith(WHATSAPP_SEND_EVENT, {
        conversationId: CHAT,
        text: '*Asha from Sunrise Mind*\nHappy to help.',
        handledBy: WaHandledBy.HUMAN,
        sentByUserId: 7,
      });
      expect(h.appendMessage).not.toHaveBeenCalled();
    });

    it('on WhatsApp after 24 hours: refused in plain words, nothing sent', async () => {
      const h = harness({
        holderId: 7,
        channel: 'whatsapp',
        lastInbound: new Date('2026-11-10T09:00:00Z'),
      });
      await expect(
        h.service.reply(
          BOT,
          CHAT,
          asha,
          'Hello',
          new Date('2026-11-12T10:00:00Z'),
        ),
      ).rejects.toMatchObject({
        response: { errorCode: 'whatsapp_window_closed' },
      });
      expect(h.emitter.emitAsync).not.toHaveBeenCalled();
    });

    it('WA-A: on WhatsApp, a file and reply buttons ride with the reply', async () => {
      const h = harness({
        holderId: 7,
        channel: 'whatsapp',
        lastInbound: new Date('2026-11-12T09:00:00Z'),
      });
      const media = {
        kind: 'document' as const,
        key: 'wa-media/bot-1/chat/team-1.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 2048,
        filename: 'form.pdf',
      };
      await h.service.reply(
        BOT,
        CHAT,
        asha,
        '',
        new Date('2026-11-12T10:00:00Z'),
        { media, buttons: [' Yes ', ''] },
      );
      expect(h.emitter.emitAsync).toHaveBeenCalledWith(WHATSAPP_SEND_EVENT, {
        conversationId: CHAT,
        text: '*Asha from Sunrise Mind*',
        handledBy: WaHandledBy.HUMAN,
        sentByUserId: 7,
        media,
        buttons: ['Yes'],
      });
    });

    it('WA-A: a file on a web chat is refused in plain words', async () => {
      const h = harness({ holderId: 7 });
      await expect(
        h.service.reply(BOT, CHAT, asha, 'here', new Date(), {
          media: {
            kind: 'image',
            key: 'wa-media/x.png',
            mimeType: 'image/png',
            sizeBytes: 10,
          },
        }),
      ).rejects.toMatchObject({
        response: { errorCode: 'files_whatsapp_only' },
      });
      expect(h.appendMessage).not.toHaveBeenCalled();
    });

    it('only the person holding the chat can reply', async () => {
      const h = harness({ holderId: 8 });
      await expect(
        h.service.reply(BOT, CHAT, asha, 'Hello'),
      ).rejects.toMatchObject({
        response: { errorCode: 'not_yours' },
      });
      expect(h.appendMessage).not.toHaveBeenCalled();
    });
  });

  describe('the jobs', () => {
    it('hands a chat back after the hours with no team reply, and tells the visitor', async () => {
      const h = harness({ holderId: 7 });
      h.query.mockImplementationOnce(async () => [
        {
          id: CHAT,
          chatbot_id: 'bot-1',
          channel: 'web',
          since: new Date('2026-11-11T08:00:00Z'),
        },
      ]);
      h.query.mockImplementationOnce(async () => [
        { id: 'bot-1', settings: {} },
      ]);
      h.query.mockImplementationOnce(async () => [[{ id: CHAT }], 1]);
      await expect(
        h.service.autoHandBack(new Date('2026-11-12T10:00:00Z')),
      ).resolves.toBe(1);
      expect(h.appendMessage).toHaveBeenCalledWith(
        CHAT,
        expect.objectContaining({
          text: "The team couldn't reply this time, so I'm back to help. You can ask for a person again any time.",
          handledBy: WaHandledBy.HANDOVER,
        }),
      );
    });

    it('emails the owners once about an unopened chat, with no message text', async () => {
      const info = jest.spyOn(LoggerService.prototype, 'info');
      const h = harness();
      h.query.mockImplementationOnce(async () => [
        {
          id: CHAT,
          chatbot_id: 'bot-1',
          needs_person_since: new Date('2026-11-12T09:00:00Z'),
          assistant: 'Sunrise Mind',
        },
      ]);
      h.query.mockImplementationOnce(async () => [
        { id: 'bot-1', settings: {} },
      ]);
      await expect(
        h.service.emailUnopened(new Date('2026-11-12T09:20:00Z')),
      ).resolves.toBe(1);
      // Through the outbox, not sent here: a failed send is retried and never marked sent.
      expect(h.email.sendHandoverAlert).not.toHaveBeenCalled();
      expect(h.outbox.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          recipient: 'owner@clinic.example',
          channel: 'email',
          kind: 'needs_person',
          dedupeKey: 'needs_person:conv-1:owner@clinic.example',
          payload: {
            subject: 'A conversation needs you',
            body: 'Someone talking to Sunrise Mind would like a person. Nobody has opened the conversation yet. Open it: https://admin.example/chatbots?tab=inbox&conversation=conv-1&bot=bot-1',
          },
        }),
      );
      expect(info.mock.calls.map((c) => String(c[0])).join('\n')).not.toMatch(
        /owner@/,
      );
      info.mockRestore();
    });

    it("waits the owner's minutes before emailing", async () => {
      const h = harness();
      h.query.mockImplementationOnce(async () => [
        {
          id: CHAT,
          chatbot_id: 'bot-1',
          needs_person_since: new Date('2026-11-12T09:10:00Z'),
          assistant: 'x',
        },
      ]);
      h.query.mockImplementationOnce(async () => [
        { id: 'bot-1', settings: {} },
      ]);
      await expect(
        h.service.emailUnopened(new Date('2026-11-12T09:20:00Z')),
      ).resolves.toBe(0);
      expect(h.outbox.enqueue).not.toHaveBeenCalled();
    });

    it('marks the chat emailed only after the rows are queued', async () => {
      const h = harness();
      h.query.mockImplementationOnce(async () => [
        {
          id: CHAT,
          chatbot_id: 'bot-1',
          needs_person_since: new Date('2026-11-12T09:00:00Z'),
          assistant: 'x',
        },
      ]);
      h.query.mockImplementationOnce(async () => [
        { id: 'bot-1', settings: {} },
      ]);
      h.outbox.enqueue.mockRejectedValueOnce(new Error('db down'));
      await expect(
        h.service.emailUnopened(new Date('2026-11-12T09:20:00Z')),
      ).rejects.toThrow('db down');
    });

    it('a digest bot gets one hourly email, held to the next hour', async () => {
      const h = harness();
      h.query.mockImplementationOnce(async () => [
        {
          id: CHAT,
          chatbot_id: 'bot-1',
          needs_person_since: new Date('2026-11-12T09:00:00Z'),
          assistant: 'x',
        },
      ]);
      h.query.mockImplementationOnce(async () => [
        { id: 'bot-1', settings: { alertPolicy: { mode: 'digest' } } },
      ]);
      await h.service.emailUnopened(new Date('2026-11-12T09:20:00Z'));
      const call = h.outbox.enqueue.mock.calls[0][0];
      expect(call.kind).toBe('needs_person_digest');
      expect(call.dedupeKey).toMatch(/^digest:\d+:owner@clinic.example$/);
      expect(call.notBefore).toEqual(new Date('2026-11-12T10:00:00Z'));
    });
  });

  describe('crisis flags', () => {
    it('a crisis reply flags the conversation through the crisis service', async () => {
      const h = harness();
      await h.service.afterDecision(
        BOT,
        CHAT,
        {
          handledBy: WaHandledBy.CRISIS,
          body: 'x',
          templateId: 't',
          // Stage 4: the engine sets the level and path; nothing is inferred.
          crisis: { level: 1, path: 'keyword' },
        },
        new Date('2026-11-12T09:00:00Z'),
      );
      expect(h.crisis.flag).toHaveBeenCalledWith(
        BOT,
        CHAT,
        { level: 1, path: 'keyword' },
        new Date('2026-11-12T09:00:00Z'),
      );
    });

    it('taking over marks the flag taken', async () => {
      const h = harness();
      await h.service.takeOver('bot-1', CHAT, 7);
      expect(h.crisis.markTaken).toHaveBeenCalledWith(CHAT);
    });

    it('a flagged chat never goes back to the assistant unless the owner allows it', async () => {
      const h = harness();
      const stale = new Date('2026-11-10T00:00:00Z');
      const held = [
        {
          id: CHAT,
          chatbot_id: 'bot-1',
          channel: 'web',
          since: stale,
          safety_first_at: stale,
        },
      ];
      h.query.mockImplementationOnce(async () => held);
      h.query.mockImplementationOnce(async () => [
        { id: 'bot-1', settings: {} },
      ]);
      await expect(
        h.service.autoHandBack(new Date('2026-11-12T09:00:00Z')),
      ).resolves.toBe(0);
    });
  });

  describe('stage 4', () => {
    it('reminds the customer that a person and the AI can read the chat when someone takes over', async () => {
      const h = harness();
      h.query.mockImplementation(async (sql: string) => {
        if (sql.includes('SET handled_by_user_id = $3'))
          return [[{ id: CHAT }], 1];
        if (sql.includes('"lastText"'))
          return [{ channel: 'web', name: 'Sunrise', lastText: 'hello' }];
        return [];
      });
      await h.service.takeOver('bot-1', CHAT, 7);
      const calls = h.appendMessage.mock.calls;
      const stored = calls[calls.length - 1]?.[1];
      expect(stored?.text).toBe(
        'A person from Sunrise has joined this chat. They and the AI can read this conversation.',
      );
      expect(h.events.publishVisitor).toHaveBeenCalledWith(CHAT, {
        type: 'state',
        by: 'person',
      });
      expect(h.events.publishVisitor).toHaveBeenCalledWith(
        CHAT,
        expect.objectContaining({ type: 'message', text: stored?.text }),
      );
    });

    it('hands a chat back after the owner’s minutes of idle time, not hours', async () => {
      const now = new Date('2026-11-12T09:00:00Z');
      const run = async (
        minutesIdle: number,
        handover: Record<string, unknown>,
      ) => {
        const h = harness();
        const since = new Date(now.getTime() - minutesIdle * 60_000);
        h.query.mockImplementation(async (sql: string) => {
          if (
            sql.includes('FROM chatbot_conversations c') &&
            sql.includes('GREATEST')
          )
            return [
              {
                id: CHAT,
                chatbot_id: 'bot-1',
                channel: 'web',
                since,
                safety_first_at: null,
              },
            ];
          if (sql.includes('FROM chatbots WHERE id'))
            return [{ id: 'bot-1', settings: {} }];
          if (sql.includes('SET handled_by_user_id = NULL'))
            return [[{ id: CHAT }], 1];
          return [];
        });
        (
          h.service as unknown as { settings: { getForChatbot: jest.Mock } }
        ).settings.getForChatbot.mockResolvedValue({
          ...DEFAULT_WHATSAPP_SETTINGS,
          handover,
        });
        return h.service.autoHandBack(now);
      };
      await expect(run(20, {})).resolves.toBe(0); // default 30 minutes
      await expect(run(31, {})).resolves.toBe(1);
      await expect(run(6, { autoHandBackMinutes: 5 })).resolves.toBe(1);
    });
  });
});
