import { WaHandledBy } from '../../../whatsapp/enum/whatsapp.enum';
import {
  CONSENT_RECORDED_COPY,
  ChatPrivacyService,
} from '../chat-privacy.service';
import { ERASE_CANCELLED_COPY, ERASE_CONFIRM_COPY } from '../erase-copy';

const CONV = '6f9c1a52-1111-4a8e-9a0c-1b2c3d4e5f60';
const CONTACT = '7a9c1a52-2222-4a8e-9a0c-1b2c3d4e5f61';

/** The stage 5 hooks a channel runs around the engine: erase in chat and memory consent. */
describe('ChatPrivacyService', () => {
  const setup = (
    opts: { pending?: unknown; consent?: string; memoryOn?: boolean } = {},
  ) => {
    const erasure = {
      pendingFor: jest.fn().mockResolvedValue(opts.pending ?? null),
      setPending: jest.fn().mockResolvedValue(undefined),
      eraseEndPerson: jest.fn().mockResolvedValue({
        erased: ['conversations', 'memory', 'contact_details'],
        kept: [{ what: 'sign_in', why: '' }],
        counts: {},
        keptConversationIds: [],
        found: true,
      }),
    };
    const consent = {
      stateFor: jest.fn().mockResolvedValue({
        state: opts.consent ?? 'unasked',
        subjectKey: `contact:${CONTACT}`,
        wordingVersion: 'v-test',
      }),
      ask: jest
        .fn()
        .mockResolvedValue({ text: 'Can I remember?', wordingVersion: 'v' }),
      record: jest.fn().mockResolvedValue({}),
    };
    const memory = {
      forgetName: jest.fn().mockResolvedValue(true),
      nameNow: jest.fn().mockResolvedValue(null),
    };
    const service = new ChatPrivacyService(
      erasure as never,
      consent as never,
      memory as never,
    );
    const chatbot = {
      id: 'bot-1',
      settings: { memory: { on: opts.memoryOn ?? true } },
    };
    const turn = (text: string, extra: Record<string, unknown> = {}) => ({
      chatbot,
      conversationId: CONV,
      contactId: CONTACT,
      phone: '+919800000001',
      text,
      crisisKeyword: false,
      ...extra,
    });
    return { service, erasure, consent, memory, chatbot, turn };
  };

  describe('the name (TF1 round 2, Saathi B-2)', () => {
    it.each([
      'forget my name',
      'Please delete my name',
      'mera naam hata do',
      'मेरा नाम भूल जाओ',
    ])('"%s" removes only the name, at once', async (text) => {
      const h = setup();
      const reply = await h.service.beforeTurn(h.turn(text));
      expect(reply?.kind).toBe('name_forgotten');
      expect(h.memory.forgetName).toHaveBeenCalledWith('bot-1', CONTACT);
      expect(h.erasure.eraseEndPerson).not.toHaveBeenCalled();
    });

    it('"forget me" is still the full erase, with its confirm', async () => {
      const h = setup();
      const reply = await h.service.beforeTurn(h.turn('forget me'));
      expect(reply?.kind).toBe('erase_confirm');
      expect(h.memory.forgetName).not.toHaveBeenCalled();
    });

    it("the agent's reply that learns the name says so once; a crisis reply never", async () => {
      const h = setup();
      h.memory.nameNow.mockResolvedValue('Asha');
      const notice = await h.service.nameNotice({
        chatbot: { ...h.chatbot, safetyPack: null } as never,
        contactId: CONTACT,
        decision: { handledBy: WaHandledBy.RAG, body: 'Hi Asha!' } as never,
        text: "Hi, I'm Asha",
      });
      expect(notice).toEqual({
        name: 'Asha',
        notice:
          "I'll use the name Asha in our chats. Say 'forget my name' any time.",
      });
      expect(
        await h.service.nameNotice({
          chatbot: { ...h.chatbot, safetyPack: null } as never,
          contactId: CONTACT,
          decision: { handledBy: WaHandledBy.CRISIS, body: '…' } as never,
          text: "I'm Asha and I want to die",
        }),
      ).toBeNull();
    });
  });

  it('asks to confirm an erase request, and stores the pending question', async () => {
    const h = setup();
    const reply = await h.service.beforeTurn(h.turn('please delete my data'));
    expect(reply).toMatchObject({
      kind: 'erase_confirm',
      body: ERASE_CONFIRM_COPY.en,
      handledBy: WaHandledBy.TEMPLATE,
    });
    expect(h.erasure.setPending).toHaveBeenCalledWith(
      CONV,
      expect.objectContaining({ askedAt: expect.any(String) }),
    );
    expect(h.erasure.eraseEndPerson).not.toHaveBeenCalled();
  });

  it('a yes within the window erases by the WhatsApp number and contact, and says what was kept', async () => {
    const h = setup({ pending: { askedAt: new Date().toISOString() } });
    const reply = await h.service.beforeTurn(h.turn('yes'));
    expect(h.erasure.eraseEndPerson).toHaveBeenCalledWith('bot-1', {
      contactId: CONTACT,
      phone: '+919800000001',
      email: null,
    });
    expect(reply?.kind).toBe('erase_done');
    expect(reply?.body).toMatch(/^Done\. I have erased/);
    expect(reply?.body).toContain('access list');
    expect(h.erasure.setPending).toHaveBeenCalledWith(CONV, null);
  });

  it('a no cancels; an expired question is never acted on', async () => {
    const h = setup({ pending: { askedAt: new Date().toISOString() } });
    expect((await h.service.beforeTurn(h.turn('no')))?.body).toBe(
      ERASE_CANCELLED_COPY.en,
    );
    const old = setup({
      pending: { askedAt: new Date(Date.now() - 60 * 60_000).toISOString() },
      consent: 'granted',
    });
    expect(await old.service.beforeTurn(old.turn('yes'))).toBeNull();
    expect(old.erasure.eraseEndPerson).not.toHaveBeenCalled();
    expect(old.erasure.setPending).toHaveBeenCalledWith(CONV, null);
  });

  it('a crisis keyword skips every privacy step', async () => {
    const h = setup();
    expect(
      await h.service.beforeTurn(
        h.turn('delete my data, I want to die', { crisisKeyword: true }),
      ),
    ).toBeNull();
    expect(h.erasure.pendingFor).not.toHaveBeenCalled();
  });

  it('records a YES to the open consent question and acknowledges it', async () => {
    const h = setup({ consent: 'asked' });
    const reply = await h.service.beforeTurn(h.turn('Yes'));
    expect(h.consent.record).toHaveBeenCalledWith(
      'bot-1',
      CONTACT,
      'granted',
      'v-test',
    );
    expect(reply?.body).toBe(CONSENT_RECORDED_COPY.granted.en);
  });

  // TF1: Kiran's yes to "Shall I book you…?" was taken as the answer to an old consent question.
  it('a yes to something else goes to the engine, even with the question still open', async () => {
    const h = setup({ consent: 'asked' });
    (h.consent as Record<string, unknown>).askedLast = jest
      .fn()
      .mockResolvedValue(false);
    expect(await h.service.beforeTurn(h.turn('Yes'))).toBeNull();
    expect(h.consent.record).not.toHaveBeenCalled();
  });

  it('a yes with no consent question open goes to the engine', async () => {
    const h = setup({ consent: 'unasked' });
    expect(await h.service.beforeTurn(h.turn('yes'))).toBeNull();
    expect(h.consent.record).not.toHaveBeenCalled();
  });

  it('asks the consent question once, after the agent’s own reply, only with memory on', async () => {
    const h = setup();
    const ask = (handledBy: WaHandledBy, extra = {}) =>
      h.service.consentQuestion({
        chatbot: h.chatbot,
        contactId: CONTACT,
        decision: { handledBy, ...extra },
        text: 'hours?',
      });
    expect(await ask(WaHandledBy.RAG)).toBe('Can I remember?');
    expect(await ask(WaHandledBy.CRISIS)).toBeNull();
    expect(
      await ask(WaHandledBy.RAG, { blocked: 'OUT_OF_CREDITS' }),
    ).toBeNull();
    const asked = setup({ consent: 'asked' });
    expect(
      await asked.service.consentQuestion({
        chatbot: asked.chatbot,
        contactId: CONTACT,
        decision: { handledBy: WaHandledBy.RAG },
        text: 'hours?',
      }),
    ).toBeNull();
    const off = setup({ memoryOn: false });
    expect(
      await off.service.consentQuestion({
        chatbot: off.chatbot,
        contactId: CONTACT,
        decision: { handledBy: WaHandledBy.RAG },
        text: 'hours?',
      }),
    ).toBeNull();
  });
});
