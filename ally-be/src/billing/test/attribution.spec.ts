import { usageContext } from '../context/usage-context';
import { UsageChannel, UsageKind } from '../enum/billing.enum';
import { usageContextFor } from 'src/chatbot/engine/engine-usage';
import { UsageEventService } from '../service/usage-event.service';
import {
  countryOf,
  parseWhatsAppBillables,
} from '../service/whatsapp-pricing.service';
import { csvCell } from '../service/cost-report.service';

const bot = {
  id: 'b0000000-0000-4000-8000-000000000001',
  createdBy: 42,
} as never;

describe('engine usage context', () => {
  it('names the channel from the turn', () => {
    const base = {
      chatbot: bot,
      providerMessageId: 'm1',
      conversationId: 'c1',
    } as never;
    expect(
      usageContextFor({
        ...(base as object),
        channel: { type: 'whatsapp' },
      } as never),
    ).toMatchObject({
      channel: UsageChannel.WHATSAPP,
      runKind: UsageKind.CUSTOMER_REPLY,
      creatorUserId: 42,
    });
    usageContext.run(
      { channel: UsageChannel.BUBBLE, runKind: UsageKind.CUSTOMER_REPLY },
      () => {
        expect(
          usageContextFor({
            ...(base as object),
            channel: { type: 'web' },
          } as never).channel,
        ).toBe(UsageChannel.BUBBLE);
      },
    );
    expect(
      usageContextFor({
        ...(base as object),
        channel: { type: 'web' },
      } as never).channel,
    ).toBe(UsageChannel.BOT_PAGE);
  });

  it('derives the run id from the provider message id, so a redelivery meters nothing twice', () => {
    const turn = {
      chatbot: bot,
      providerMessageId: 'm1',
      channel: { type: 'whatsapp' },
    } as never;
    expect(usageContextFor(turn).runId).toBe(usageContextFor(turn).runId);
  });

  it('is Try it on the test channel, and a checkup inside a checkup', () => {
    const turn = { chatbot: bot, channel: { type: 'test' } } as never;
    expect(usageContextFor(turn).runKind).toBe(UsageKind.TRY_IT);
    usageContext.run(
      { channel: UsageChannel.OWNER, runKind: UsageKind.CHECKUP },
      () => {
        expect(usageContextFor(turn).runKind).toBe(UsageKind.CHECKUP);
      },
    );
  });
});

describe('UsageEventService.attributionOf', () => {
  it('reads an attributed usage message', () => {
    expect(
      UsageEventService.attributionOf({
        run_id: 'r1',
        kind: 'crisis_check',
        channel: 'whatsapp',
        chatbot_id: bot['id' as never],
        step: 2,
        seq: 3,
      }),
    ).toMatchObject({
      runId: 'r1',
      kind: 'crisis_check',
      channel: 'whatsapp',
      step: 2,
      seq: 3,
    });
  });
  it('ignores usage that isn’t an assistant’s (Learn, Debrief)', () => {
    expect(
      UsageEventService.attributionOf({ scenario_session_id: 'x' }),
    ).toBeNull();
    expect(
      UsageEventService.attributionOf({
        run_id: 'r',
        kind: 'nonsense',
        chatbot_id: 'x',
      }),
    ).toBeNull();
    expect(
      UsageEventService.attributionOf({ run_id: 'r', kind: 'setup' }),
    ).toBeNull();
  });
  it('keeps an unknown channel as other', () => {
    expect(
      UsageEventService.attributionOf({
        run_id: 'r',
        kind: 'setup',
        channel: 'fax',
        creator_user_id: 7,
      })?.channel,
    ).toBe('other');
  });
});

describe('WhatsApp billables', () => {
  const body = (pricing: object | undefined, status = 'delivered') => ({
    entry: [
      {
        changes: [
          {
            value: {
              statuses: [
                {
                  id: 'wamid.1',
                  status,
                  timestamp: '1763500000',
                  recipient_id: '919000000001',
                  pricing,
                },
              ],
            },
          },
        ],
      },
    ],
  });
  it('keeps billable messages with their category', () => {
    expect(
      parseWhatsAppBillables(
        body({ billable: true, category: 'utility', pricing_model: 'PMP' }),
      ),
    ).toMatchObject([
      { messageId: 'wamid.1', category: 'utility', recipient: '919000000001' },
    ]);
  });
  it('skips free, failed and unpriced statuses', () => {
    expect(
      parseWhatsAppBillables(body({ billable: false, category: 'service' })),
    ).toEqual([]);
    expect(
      parseWhatsAppBillables(
        body({ billable: true, category: 'service' }, 'failed'),
      ),
    ).toEqual([]);
    expect(parseWhatsAppBillables(body(undefined))).toEqual([]);
    expect(parseWhatsAppBillables({})).toEqual([]);
  });
  it('finds the country from the number', () => {
    expect(countryOf('+91 90000 00001')).toBe('IN');
    expect(countryOf('971500000000')).toBe('AE');
    expect(countryOf('00')).toBeNull();
  });
});

it('CSV cells are quoted and never formulas', () => {
  expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
  expect(csvCell('a,b')).toBe('"a,b"');
  expect(csvCell(null)).toBe('');
});
