import { ConversationService } from 'src/chatbot/service/conversation.service';
import {
  ConversationChannel,
  ConversationMessageRole,
} from 'src/chatbot/enum/conversation.enum';
import { WaMessage } from '../../entity/wa-message.entity';
import { WaMessageDirection, WaMessageStatus } from '../../enum/whatsapp.enum';
import { WhatsAppConversationService } from '../../service/whatsapp-conversation.service';
import { WhatsAppRetentionService } from '../../service/whatsapp-retention.service';
import {
  contactIdsFor,
  hasThread,
  PLACEHOLDER_ID,
  sharedMessageOf,
} from '../wa-shared-store.mapper';
import { WaSharedStoreWriter } from '../wa-shared-store.writer';

const message = (overrides: Partial<WaMessage> = {}): WaMessage =>
  ({
    id: 'm-1',
    conversationId: 'conv-1',
    contactId: 'contact-1',
    direction: WaMessageDirection.INBOUND,
    body: 'hello',
    status: WaMessageStatus.PROCESSING,
    createdAt: new Date('2026-11-07T10:00:00Z'),
    ...overrides,
  }) as WaMessage;

describe('wa-shared-store mapper', () => {
  it('keeps the wa contact id first, then a stable id derived from the bot', () => {
    const [first, second] = contactIdsFor('contact-1', 'bot-1');
    expect(first).toBe('contact-1');
    expect(contactIdsFor('contact-1', 'bot-1')[1]).toBe(second);
    expect(contactIdsFor('contact-1', 'bot-2')[1]).not.toBe(second);
  });

  it('copies a message with its id, createdAt and role', () => {
    expect(
      sharedMessageOf(message({ direction: WaMessageDirection.OUTBOUND })),
    ).toMatchObject({
      id: 'm-1',
      createdAt: new Date('2026-11-07T10:00:00Z'),
      channel: ConversationChannel.WHATSAPP,
      role: ConversationMessageRole.ASSISTANT,
      text: 'hello',
    });
  });

  it('a message discarded before its contact was known has no thread', () => {
    expect(hasThread(message({ conversationId: PLACEHOLDER_ID }))).toBe(false);
    expect(hasThread(message())).toBe(true);
  });
});

describe('WaSharedStoreWriter', () => {
  const on = { sharedStoreWrites: true } as never;

  function writer(store: Partial<ConversationService>, rows: WaMessage[]) {
    return new WaSharedStoreWriter(
      store as ConversationService,
      { get: async () => on } as never,
      { find: async () => rows } as never,
      {
        findOne: async () => ({
          id: 'conv-1',
          chatbotId: 'bot-1',
          contactId: 'contact-1',
          startedAt: new Date(),
          lastMessageAt: new Date(),
        }),
      } as never,
      {
        findOne: async () => ({
          id: 'contact-1',
          phoneE164: '9198',
          firstSeenAt: new Date(),
        }),
      } as never,
    );
  }

  const workingStore = (log: string[] = []) => ({
    resolveContact: jest.fn(async () => ({ id: 'contact-1' })),
    openConversation: jest.fn(async () => ({ id: 'conv-1' })),
    appendMessage: jest.fn(async (_: string, m: { id?: string }) => {
      log.push(`append ${m.id}`);
      return {};
    }),
    updateMessage: jest.fn(async () => undefined),
  });

  it('never rejects, whatever the store throws', async () => {
    const store = {
      resolveContact: async () => {
        throw new Error('down');
      },
    };
    const subject = writer(store as never, [message()]);
    await expect(subject.mirrorInbound(on, 'm-1')).resolves.toBe(false);
    await expect(subject.sync(['m-1'])).resolves.toBe(false);
  });

  it('copies a reply only after its inbound copy has landed', async () => {
    const log: string[] = [];
    const store = workingStore(log);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    store.resolveContact.mockImplementationOnce(async () => {
      await gate;
      log.push('inbound thread');
      return { id: 'contact-1' };
    });
    const subject = writer(store as never, [message()]);
    void subject.mirrorInbound(on, 'm-1');
    const reply = subject.sync(['m-1'], 'm-1');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(log).toEqual([]);
    release();
    await reply;
    expect(log.indexOf('inbound thread')).toBe(0);
  });

  it('skips a message that never got a thread', async () => {
    const store = workingStore();
    const subject = writer(store as never, [
      message({ conversationId: PLACEHOLDER_ID }),
    ]);
    await expect(subject.sync(['m-1'])).resolves.toBe(true);
    expect(store.appendMessage).not.toHaveBeenCalled();
  });

  it('settled() waits for every copy in flight', async () => {
    const store = workingStore();
    const subject = writer(store as never, [message()]);
    void subject.mirrorInbound(on, 'm-1');
    await subject.settled();
    expect(store.appendMessage).toHaveBeenCalledTimes(1);
    expect(store.updateMessage).toHaveBeenCalledTimes(1);
  });
});

describe('Retention and erasure over the shared store', () => {
  function retention(store?: Partial<ConversationService>) {
    const calls: string[] = [];
    const messageRepository = {
      count: async () => 1,
      find: jest
        .fn()
        .mockResolvedValueOnce([{ id: 'm-1' }])
        .mockResolvedValue([]),
      update: jest.fn(async () => {
        calls.push('wa messages');
      }),
    };
    const service = new WhatsAppRetentionService(
      messageRepository as never,
      { findOne: async () => null, update: jest.fn() } as never,
      {
        createQueryBuilder: () => ({
          select: () => ({
            groupBy: () => ({
              having: () => ({ getRawMany: async () => [] }),
            }),
          }),
        }),
      } as never,
      { update: async () => ({ affected: 0 }) } as never,
      { get: async () => ({ retentionDays: 30 }) } as never,
      store
        ? ({
            blankBefore: jest.fn(async () => {
              calls.push('shared');
              return store.blankBefore!(new Date(), {
                text: '',
                erasedPrefix: '',
              });
            }),
          } as never)
        : undefined,
    );
    return { service, calls };
  }

  it('blanks wa_* first, then the shared store', async () => {
    const { service, calls } = retention({
      blankBefore: async () => ({ messages: 1, identities: 0 }),
    });
    await service.runRetentionSweep();
    expect(calls).toEqual(['wa messages', 'shared']);
  });

  it('a failed shared pass is logged, not thrown, and wa_* is already swept', async () => {
    const { service, calls } = retention({
      blankBefore: async () => {
        throw new Error('shared store down');
      },
    });
    await expect(service.runRetentionSweep()).resolves.toBeUndefined();
    expect(calls).toEqual(['wa messages', 'shared']);
  });

  function erasure(store: Partial<ConversationService>) {
    return new WhatsAppConversationService(
      {
        findOne: async () => ({ id: 'contact-1', phoneE164: '9198' }),
        update: jest.fn(),
      } as never,
      { find: async () => [{ id: 'conv-1' }, { id: 'conv-2' }] } as never,
      { update: jest.fn() } as never,
      { update: jest.fn() } as never,
      {} as never,
      {} as never,
      {} as never,
      { accessibleChatbotIds: async () => null } as never,
      store as ConversationService,
    );
  }

  it('erasure blanks the shared copies of every thread of the contact', async () => {
    const store = { eraseConversations: jest.fn(async () => undefined) };
    await erasure(store).eraseContact('contact-1');
    expect(store.eraseConversations).toHaveBeenCalledWith(
      ['conv-1', 'conv-2'],
      ConversationChannel.WHATSAPP,
      { text: '[erased]', erasedPrefix: 'erased:' },
    );
  });

  it('erasure fails when the shared store fails, so it is never half done', async () => {
    const store = {
      eraseConversations: async () => {
        throw new Error('shared store down');
      },
    };
    await expect(erasure(store).eraseContact('contact-1')).rejects.toThrow(
      'shared store down',
    );
  });
});
