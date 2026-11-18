import { ConversationService } from 'src/chatbot/service/conversation.service';
import { WaConsentStatus, WaMessageDirection } from '../../enum/whatsapp.enum';
import type { WhatsAppBotSettings } from '../../type/whatsapp-settings.type';
import { contactIdsFor } from '../wa-shared-store.mapper';
import {
  SHARED_HISTORY_WAIT_MS,
  WaSharedStoreWriter,
} from '../wa-shared-store.writer';
import { buildInboundHarness } from './inbound-harness';

/**
 * The inbound handler with the shared-store writer, on mocked repositories: what the writer may
 * and may not do to a WhatsApp reply. The Postgres specs check the rows themselves.
 */

const CHATBOT_ID = 'bot-1';
const INBOUND_ID = 'inbound-1';
const CONVERSATION_ID = 'conv-1';
const WA_HISTORY = [{ direction: WaMessageDirection.INBOUND, body: 'from wa' }];

function mockRepositories() {
  const messageRows = new Map<string, Record<string, unknown>>();
  let outbound = 0;
  const messages = {
    createQueryBuilder: () => ({
      insert: () => ({
        into: () => ({
          values: (row: Record<string, unknown>) => ({
            orIgnore: () => ({
              returning: () => ({
                execute: async () => {
                  messageRows.set(INBOUND_ID, { ...row, id: INBOUND_ID });
                  return { raw: [{ id: INBOUND_ID }] };
                },
              }),
            }),
          }),
        }),
      }),
    }),
    update: jest.fn(async ({ id }: { id: string }, patch: object) => {
      messageRows.set(id, { ...messageRows.get(id), ...patch });
    }),
    create: (row: Record<string, unknown>) => row,
    save: jest.fn(async (row: Record<string, unknown>) => {
      const id = `outbound-${++outbound}`;
      messageRows.set(id, { ...row, id });
      return { ...row, id };
    }),
    // The history read; the writer's reads by id come through `find` with an `In`.
    find: jest.fn(async (options: { where: Record<string, unknown> }) =>
      'conversationId' in options.where ? WA_HISTORY : [],
    ),
  };
  const qb: Record<string, unknown> = {};
  Object.assign(qb, {
    where: () => qb,
    andWhere: () => qb,
    orderBy: () => qb,
    getOne: async () => ({ id: CONVERSATION_ID, messageCount: 2 }),
  });
  return {
    contacts: {
      findOne: async () => ({
        id: 'contact-1',
        phoneE164: '919800000001',
        phoneLast4: '0001',
        consentStatus: WaConsentStatus.GRANTED,
        messageCount: 3,
      }),
      update: jest.fn(),
      create: (row: object) => row,
      save: async (row: object) => row,
    },
    conversations: {
      createQueryBuilder: () => qb,
      update: jest.fn(),
      create: (row: object) => row,
      save: async (row: object) => ({ ...row, id: CONVERSATION_ID }),
    },
    messages,
    unanswered: { createQueryBuilder: jest.fn() },
  };
}

/** A writer whose store does whatever `store` says; its wa reads come from the mock repositories. */
function writerFor(
  store: Partial<ConversationService>,
  settings: () => WhatsAppBotSettings,
) {
  return new WaSharedStoreWriter(
    store as ConversationService,
    { get: async () => settings() } as never,
    { find: async () => [] } as never,
    { findOne: async () => null } as never,
    { findOne: async () => null } as never,
  );
}

function build(
  settings: Partial<WhatsAppBotSettings>,
  sharedStore?: (settings: () => WhatsAppBotSettings) => WaSharedStoreWriter,
) {
  const holder: { settings?: WhatsAppBotSettings } = {};
  const writer = sharedStore?.(() => holder.settings!);
  const harness = buildInboundHarness({
    repositories: mockRepositories() as never,
    chatbotId: CHATBOT_ID,
    settings,
    sharedStore: writer,
  });
  holder.settings = harness.settings;
  return { ...harness, writer };
}

const historyGiven = (engine: { respond: jest.Mock }) =>
  engine.respond.mock.calls[0][0].history;

describe('WhatsApp inbound with the shared store', () => {
  it('without the writer, behaves as before', async () => {
    const { inbound, engine, provider } = build({ sharedStoreWrites: true });
    await inbound('how do I get access?');
    expect(historyGiven(engine)).toEqual([
      { role: 'user', content: 'from wa' },
    ]);
    expect(provider.sendText).toHaveBeenCalledTimes(1);
  });

  it('with the switch off, never touches the shared store', async () => {
    const store = {
      resolveContact: jest.fn(),
      appendMessage: jest.fn(),
      recentHistory: jest.fn(),
    };
    const { inbound, writer } = build(
      { sharedStoreWrites: false, readHistoryFrom: 'shared' },
      (settings) => writerFor(store, settings),
    );
    await inbound('how do I get access?');
    await writer!.settled();
    expect(store.resolveContact).not.toHaveBeenCalled();
    expect(store.appendMessage).not.toHaveBeenCalled();
    expect(store.recentHistory).not.toHaveBeenCalled();
  });

  describe('the contact in the run (chunk 6)', () => {
    const contactGiven = (engine: { respond: jest.Mock }) =>
      engine.respond.mock.calls[0][0].contactId;

    it('with the switch on, resolves the shared contact before the reply, as the copy will', async () => {
      const store = {
        resolveContact: jest.fn(async () => ({ id: 'shared-contact-1' })),
        openConversation: jest.fn(async () => ({ id: CONVERSATION_ID })),
        appendMessage: jest.fn(async () => ({})),
        updateMessage: jest.fn(async () => undefined),
      };
      const { inbound, engine, writer } = build(
        { sharedStoreWrites: true },
        (settings) => writerFor(store as never, settings),
      );
      await inbound('book me in for thursday');
      await writer!.settled();
      expect(contactGiven(engine)).toBe('shared-contact-1');
      expect(store.resolveContact).toHaveBeenCalledWith(
        { chatbotId: CHATBOT_ID },
        'whatsapp',
        '919800000001',
        expect.objectContaining({
          preferredIds: contactIdsFor('contact-1', CHATBOT_ID),
        }),
      );
    });

    it('with the switch off, the run has no contact', async () => {
      const store = { resolveContact: jest.fn() };
      const { inbound, engine } = build(
        { sharedStoreWrites: false },
        (settings) => writerFor(store as never, settings),
      );
      await inbound('book me in for thursday');
      expect(contactGiven(engine)).toBeNull();
      expect(store.resolveContact).not.toHaveBeenCalled();
    });

    it('a store that fails leaves the run without a contact, and the reply goes out', async () => {
      const down = async () => {
        throw new Error('shared store down');
      };
      const { inbound, engine, provider, writer } = build(
        { sharedStoreWrites: true },
        (settings) =>
          writerFor(
            {
              resolveContact: down,
              openConversation: down,
              appendMessage: down,
              updateMessage: down,
            } as never,
            settings,
          ),
      );
      await inbound('book me in for thursday');
      await writer!.settled();
      expect(contactGiven(engine)).toBeNull();
      expect(provider.sendText).toHaveBeenCalledTimes(1);
    });
  });

  it('reading history from wa, a copy that never finishes adds no wait', async () => {
    const writer = {
      readsShared: () => false,
      mirrorInbound: jest.fn(() => new Promise<boolean>(() => undefined)),
      history: jest.fn(),
      sync: jest.fn(async () => true),
      contactIdFor: jest.fn(async () => null),
    };
    const { inbound, engine } = build(
      { sharedStoreWrites: true, readHistoryFrom: 'wa' },
      () => writer as unknown as WaSharedStoreWriter,
    );
    const started = Date.now();
    await inbound('how do I get access?');
    expect(Date.now() - started).toBeLessThan(SHARED_HISTORY_WAIT_MS / 2);
    expect(writer.mirrorInbound).toHaveBeenCalledWith(
      expect.anything(),
      INBOUND_ID,
    );
    expect(writer.history).not.toHaveBeenCalled();
    expect(historyGiven(engine)).toEqual([
      { role: 'user', content: 'from wa' },
    ]);
  });

  it('reading history from shared, waits for the copy and uses the shared history', async () => {
    const store = {
      recentHistory: jest.fn(async () => [
        { role: 'user', content: 'from shared' },
      ]),
    };
    const { inbound, engine, writer } = build(
      { sharedStoreWrites: true, readHistoryFrom: 'shared' },
      (settings) => writerFor(store, settings),
    );
    jest
      .spyOn(writer!, 'mirrorInbound')
      .mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(true), 50)),
      );
    await inbound('how do I get access?');
    expect(store.recentHistory).toHaveBeenCalledWith(CONVERSATION_ID);
    expect(historyGiven(engine)).toEqual([
      { role: 'user', content: 'from shared' },
    ]);
  });

  it('reading history from shared, waits at most the cap, then reads wa', async () => {
    const store = { recentHistory: jest.fn() };
    const { inbound, engine, writer } = build(
      { sharedStoreWrites: true, readHistoryFrom: 'shared' },
      (settings) => writerFor(store, settings),
    );
    jest
      .spyOn(writer!, 'mirrorInbound')
      .mockImplementation(() => new Promise<boolean>(() => undefined));
    const started = Date.now();
    await inbound('how do I get access?');
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(SHARED_HISTORY_WAIT_MS - 10);
    expect(elapsed).toBeLessThan(SHARED_HISTORY_WAIT_MS * 3);
    expect(store.recentHistory).not.toHaveBeenCalled();
    expect(historyGiven(engine)).toEqual([
      { role: 'user', content: 'from wa' },
    ]);
  });

  it('a shared store that throws on every call changes nothing on WhatsApp', async () => {
    const down = async () => {
      throw new Error('shared store down');
    };
    const store = {
      resolveContact: down,
      openConversation: down,
      appendMessage: down,
      updateMessage: down,
      recentHistory: down,
    };
    const { inbound, engine, provider, writer } = build(
      { sharedStoreWrites: true, readHistoryFrom: 'shared' },
      (settings) => writerFor(store as never, settings),
    );
    await expect(inbound('how do I get access?')).resolves.toBeUndefined();
    await writer!.settled();
    expect(provider.sendText).toHaveBeenCalledTimes(1);
    expect(historyGiven(engine)).toEqual([
      { role: 'user', content: 'from wa' },
    ]);
  });

  it('copies the reply only after it was sent, waiting for the inbound copy', async () => {
    const order: string[] = [];
    const writer = {
      readsShared: () => false,
      mirrorInbound: jest.fn(async () => true),
      history: jest.fn(),
      sync: jest.fn(async (ids: string[], after?: string) => {
        order.push(`sync ${ids.join(',')} after ${after}`);
        return true;
      }),
      contactIdFor: jest.fn(async () => null),
    };
    const { inbound, provider } = build({ sharedStoreWrites: true }, () => {
      return writer as unknown as WaSharedStoreWriter;
    });
    provider.sendText.mockImplementation(async () => {
      order.push('send');
      return { providerMessageId: 'wamid.out' };
    });
    await inbound('how do I get access?');
    expect(order).toEqual([
      'send',
      `sync ${INBOUND_ID},outbound-1 after ${INBOUND_ID}`,
    ]);
  });

  it('a discarded message is brought up to date in the shared store', async () => {
    const writer = {
      readsShared: () => false,
      mirrorInbound: jest.fn(async () => true),
      history: jest.fn(),
      sync: jest.fn(async () => true),
    };
    const { inbound, settings } = build({ sharedStoreWrites: true }, () => {
      return writer as unknown as WaSharedStoreWriter;
    });
    settings.enabled = false;
    await inbound('how do I get access?');
    expect(writer.sync).toHaveBeenCalledWith([INBOUND_ID], INBOUND_ID);
  });
});
