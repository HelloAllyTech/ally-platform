import { LoggerService } from '../../../logger/logger.service';
import { PrechatFieldType } from '../../enum/bot-page.enum';
import type { StoredIntake } from '../bot-page-intake';
import {
  LEAD_SUMMARY_CHARS,
  LeadAlertService,
  leadOf,
} from '../lead-alert.service';

const intake = (
  answers: { label: string; type: PrechatFieldType; value: string }[],
): StoredIntake => ({
  completedAt: '2026-11-10T00:00:00Z',
  answers: answers.map((a, i) => ({ id: `q${i + 1}`, ...a })),
  consents: [],
});

const PRECHAT = intake([
  { label: 'Your name', type: PrechatFieldType.TEXT, value: 'Asha Rao' },
  { label: 'Phone', type: PrechatFieldType.PHONE, value: '98200 11111' },
  {
    label: 'What are you looking for?',
    type: PrechatFieldType.CHOICE,
    value: 'Couples therapy',
  },
]);

describe('leadOf', () => {
  it('takes the name, phone and topic from the pre-chat', () => {
    expect(leadOf(PRECHAT, ['Do you see couples?'], false)).toEqual({
      name: 'Asha Rao',
      phone: '98200 11111',
      topic: 'Couples therapy',
      summary: 'Do you see couples?',
    });
  });

  it('finds a phone number or email in a message', () => {
    expect(
      leadOf(undefined, ['Hi', 'Call me on +91 98200 22222'], false)?.phone,
    ).toBe('+91 98200 22222');
    expect(leadOf(undefined, ['me@example.com'], false)?.phone).toBe(
      'me@example.com',
    );
  });

  it('is nothing until they give a way to reach them', () => {
    expect(leadOf(undefined, ['How much is a session?'], false)).toBeNull();
  });

  it('never carries what they said for a health pack', () => {
    const lead = leadOf(PRECHAT, ['I have been feeling very low'], true)!;
    expect(lead.summary).toBe('');
    expect(lead.topic).toBe('Couples therapy');
  });

  it('cuts a long first message', () => {
    const lead = leadOf(PRECHAT, ['x'.repeat(400)], false)!;
    expect(lead.summary.length).toBe(LEAD_SUMMARY_CHARS);
  });

  it('fills what they did not give from the deck', () => {
    const lead = leadOf(undefined, ['98200 33333'], false)!;
    expect(lead.name).toBe('Someone');
    expect(lead.topic).toBe('your services');
  });
});

describe('LeadAlertService', () => {
  const ENQUIRIES = {
    id: 'bot-1',
    purpose: 'enquiries',
    safetyPack: 'mental_health',
  };

  const setup = (metadata: Record<string, unknown> = { intake: PRECHAT }) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const query = jest.fn(async (sql: string, _params?: unknown[]) => {
      if (sql.startsWith('SELECT metadata')) return [{ metadata }];
      if (sql.includes('FROM chatbot_messages')) {
        return [{ text: 'I have been feeling very low' }];
      }
      if (sql.includes('FROM chatbot_members')) {
        return [
          { email: 'owner@clinic.example' },
          { email: 'two@clinic.example' },
        ];
      }
      return [];
    });
    const sendLeadAlert = jest.fn().mockResolvedValue(true);
    const locks = new Set<string>();
    const redis = {
      acquireLock: jest.fn(async (key: string) =>
        locks.has(key) ? false : (locks.add(key), true),
      ),
    };
    const service = new LeadAlertService(
      { query } as never,
      { sendLeadAlert } as never,
      redis as never,
      { adminBaseUrl: 'https://admin.example/' } as never,
    );
    return { service, query, sendLeadAlert };
  };

  it('emails every owner once, with the link and no health details', async () => {
    const info = jest.spyOn(LoggerService.prototype, 'info');
    const { service, sendLeadAlert } = setup();
    await expect(service.afterTurn(ENQUIRIES as never, 'c-1')).resolves.toBe(
      true,
    );
    expect(sendLeadAlert).toHaveBeenCalledTimes(2);
    const { subject, body } = sendLeadAlert.mock.calls[0][0];
    expect(subject).toBe('New enquiry from your assistant');
    expect(body).toBe(
      'Asha Rao asked about Couples therapy. Phone: 98200 11111. Open the conversation: https://admin.example/chatbots/bot-1?section=conversations',
    );
    expect(body).not.toContain('low');
    // Nothing they gave reaches a log line.
    const logged = info.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).not.toMatch(/Asha|98200|Couples|low/);
    info.mockRestore();
  });

  it('sends one alert per conversation', async () => {
    const { service, sendLeadAlert } = setup();
    await service.afterTurn(ENQUIRIES as never, 'c-1');
    await service.afterTurn(ENQUIRIES as never, 'c-1');
    expect(sendLeadAlert).toHaveBeenCalledTimes(2);
  });

  it('does nothing once the conversation was alerted', async () => {
    const { service, sendLeadAlert } = setup({
      intake: PRECHAT,
      leadAlertedAt: '2026-11-10T00:00:00Z',
    });
    await expect(service.afterTurn(ENQUIRIES as never, 'c-1')).resolves.toBe(
      false,
    );
    expect(sendLeadAlert).not.toHaveBeenCalled();
  });

  it('records the alert on the conversation', async () => {
    const { service, query } = setup();
    await service.afterTurn(ENQUIRIES as never, 'c-1');
    const update = query.mock.calls.find(([sql]) => sql.startsWith('UPDATE'));
    expect(String(update?.[1]?.[1])).toContain('leadAlertedAt');
  });

  it('only runs for a "Bring in customers" assistant', async () => {
    const { service, query } = setup();
    await service.afterTurn(
      { ...ENQUIRIES, purpose: 'answer' } as never,
      'c-1',
    );
    await service.afterTurn({ ...ENQUIRIES, purpose: null } as never, 'c-1');
    expect(query).not.toHaveBeenCalled();
  });

  it('never throws into the reply', async () => {
    const { service, query } = setup();
    query.mockRejectedValueOnce(new Error('db down'));
    await expect(service.afterTurn(ENQUIRIES as never, 'c-1')).resolves.toBe(
      false,
    );
  });
});
