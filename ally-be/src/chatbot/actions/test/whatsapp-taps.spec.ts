import axios from 'axios';
import { ActionPartsService } from '../action-parts.service';
import { ActionsService } from '../actions.service';
import { typedNumber, whatsappReplyFor } from '../whatsapp-parts';
import type { ReplyParts } from '../action-parts.service';
import { MetaWhatsAppProvider } from '../../../whatsapp/provider/meta-whatsapp.provider';
import { whatsappInteractiveFits } from '../../../whatsapp/type/whatsapp-provider.interface';
import { WaHandledBy } from '../../../whatsapp/enum/whatsapp.enum';
import {
  agentBot,
  ANSWER,
  buildInboundHarness,
  inboundText,
} from '../../../whatsapp/service/test/whatsapp-inbound-agent.fixtures';

jest.mock('axios');

const tap = (label: string, token = `tok-${label}`) => ({
  kind: 'choose' as const,
  label,
  token,
});

describe('BT1 on WhatsApp: list messages and reply buttons within Meta’s limits', () => {
  it('a confirmation card is text with Confirm and Change as reply buttons', () => {
    const parts: ReplyParts = {
      offer: {
        question: 'Shall I register you for Sun 29 Nov 2026, 11:00?',
        action: 'create',
        card: {
          list: 'Registrations',
          title: 'Sun 29 Nov 2026, 11:00',
          details: [{ label: 'Where', value: 'Bandra West station' }],
        },
        buttons: [
          { kind: 'confirm', label: 'Confirm', token: 'a.b' },
          { kind: 'change', label: 'Change', token: 'c.d' },
        ],
      },
    };
    const out = whatsappReplyFor(
      'Shall I register you for Sun 29 Nov 2026, 11:00?',
      parts,
      'en',
    );
    expect(out.text).toContain(
      '*Sun 29 Nov 2026, 11:00*\nWhere: Bandra West station',
    );
    expect(out.interactive).toEqual({
      type: 'button',
      body: out.text,
      buttons: [
        { id: 'a.b', title: 'Confirm' },
        { id: 'c.d', title: 'Change' },
      ],
    });
    expect(out.numbered?.text).toMatch(
      /Reply with a number:\n1\. Confirm\n2\. Change$/,
    );
    expect(out.numbered?.tokens).toEqual(['a.b', 'c.d']);
  });

  it('slots are a list message of at most 10 rows, titles cut to 24 characters', () => {
    const options = Array.from({ length: 12 }, (_, i) =>
      tap(`Saturday 29 November 2026, 1${i % 10}:00`, `t${i}`),
    );
    const out = whatsappReplyFor(
      'These times are free:',
      { choices: { list: 'Slots', options } },
      'en',
    );
    expect(out.interactive?.type).toBe('list');
    const rows =
      out.interactive?.type === 'list' ? out.interactive.sections[0].rows : [];
    expect(rows).toHaveLength(10);
    expect(rows.every((r) => r.title.length <= 24)).toBe(true);
    expect(rows[0].description).toBe('Saturday 29 November 2026, 10:00');
    expect(whatsappInteractiveFits(out.interactive!)).toBe(true);
  });

  it('a reply too long for an interactive message goes as numbered text only', () => {
    const out = whatsappReplyFor(
      'x'.repeat(1100),
      { choices: { list: 'Slots', options: [tap('10:00'), tap('11:00')] } },
      'en',
    );
    expect(out.interactive).toBeNull();
    expect(out.numbered?.text).toMatch(/1\. 10:00\n2\. 11:00$/);
  });

  it('a typed number is the choice; anything else is not', () => {
    expect(typedNumber('2')).toBe(2);
    expect(typedNumber(' 10. ')).toBe(10);
    expect(typedNumber('11')).toBeNull();
    expect(typedNumber('2 people')).toBeNull();
    expect(typedNumber('0')).toBeNull();
  });
});

describe('MetaWhatsAppProvider (BT1): the interactive send and the tap’s id', () => {
  const provider = new MetaWhatsAppProvider({
    whatsapp: {
      graphApiVersion: 'v21.0',
      phoneNumberId: 'p',
      accessToken: 't',
    },
  } as never);

  it('sends reply buttons as Meta expects them', async () => {
    (axios.post as jest.Mock).mockResolvedValueOnce({
      data: { messages: [{ id: 'wamid.x' }] },
    });
    await provider.sendInteractive(
      '919800000007',
      {
        type: 'button',
        body: 'Confirm?',
        buttons: [{ id: 'a.b', title: 'Confirm' }],
      },
      { phoneNumberId: 'p', accessToken: 't' },
    );
    expect((axios.post as jest.Mock).mock.calls[0][1]).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '919800000007',
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: 'Confirm?' },
        action: {
          buttons: [{ type: 'reply', reply: { id: 'a.b', title: 'Confirm' } }],
        },
      },
    });
  });

  it('never sends a message outside the limits (the numbered text goes instead)', async () => {
    (axios.post as jest.Mock).mockClear();
    await expect(
      provider.sendInteractive(
        '919800000007',
        {
          type: 'button',
          body: 'x',
          buttons: [1, 2, 3, 4].map((n) => ({ id: `${n}`, title: `${n}` })),
        },
        { phoneNumberId: 'p', accessToken: 't' },
      ),
    ).rejects.toThrow(/limits/);
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('keeps a tapped row’s or button’s id', () => {
    const [m] = provider.parseInbound({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    id: 'wamid.in',
                    from: '919800000007',
                    type: 'interactive',
                    interactive: {
                      button_reply: { id: 'a.b', title: 'Cancel' },
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    expect(m).toMatchObject({ text: 'Cancel', actionId: 'a.b' });
  });
});

describe('WhatsAppInboundService (BT1): taps and the numbered fallback', () => {
  const offerParts: ReplyParts = {
    offer: {
      question: 'Shall I register you for Sun 29 Nov 2026, 11:00?',
      action: 'create',
      card: {
        list: 'Registrations',
        title: 'Sun 29 Nov 2026, 11:00',
        details: [],
      },
      buttons: [
        { kind: 'confirm', label: 'Confirm', token: 'a.b' },
        { kind: 'change', label: 'Change', token: 'c.d' },
      ],
    },
  };

  const build = async (tapped: unknown) => {
    const actions = {
      whatsappTap: jest.fn().mockResolvedValue(tapped),
      rememberNumbered: jest.fn().mockResolvedValue(undefined),
      perform: jest.fn().mockResolvedValue(null),
      forgetOffer: jest.fn(),
    };
    const parts = { partsFor: jest.fn().mockResolvedValue(offerParts) };
    const h = await buildInboundHarness({
      chatbot: agentBot,
      agentAnswer: ANSWER,
      extraProviders: [
        { provide: ActionsService, useValue: actions },
        { provide: ActionPartsService, useValue: parts },
      ],
    });
    return { ...h, actions, parts };
  };

  it('a tapped "Cancel" button is never STOP, and the engine answers what it stands for', async () => {
    const h = await build({
      ok: true,
      firstUse: true,
      claims: {
        kind: 'cancel',
        text: 'Please cancel my registrations for Sun 29 Nov 2026, 11:00.',
      },
    });
    (h.provider as any).sendInteractive = jest
      .fn()
      .mockResolvedValue({ providerMessageId: 'wamid.i' });
    await h.service.handle({ ...inboundText('Cancel'), actionId: 'a.b' });
    const consent = h.savedMessages.find(
      (m) => m.handledBy === WaHandledBy.CONSENT,
    );
    expect(consent).toBeUndefined();
    expect(h.aiService.runAgent.mock.calls[0][0].question).toBe(
      'Please cancel my registrations for Sun 29 Nov 2026, 11:00.',
    );
    expect((h.provider as any).sendInteractive).toHaveBeenCalledWith(
      '919876543210',
      expect.objectContaining({ type: 'button' }),
      expect.anything(),
    );
  });

  it('when the interactive send fails, the numbered text goes and a typed number then counts', async () => {
    const h = await build(undefined);
    (h.provider as any).sendInteractive = jest
      .fn()
      .mockRejectedValue(new Error('131047'));
    await h.service.handle(inboundText('Book me for Sunday'));
    expect(h.provider.sendText).toHaveBeenCalledWith(
      '919876543210',
      expect.stringMatching(/Reply with a number:\n1\. Confirm\n2\. Change$/),
      expect.anything(),
    );
    expect(h.actions.rememberNumbered).toHaveBeenCalledWith('conv-1', [
      'a.b',
      'c.d',
    ]);
  });
});
