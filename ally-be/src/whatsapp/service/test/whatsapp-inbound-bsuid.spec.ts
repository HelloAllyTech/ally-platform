import { getRepositoryToken } from '@nestjs/typeorm';
import { WaContact } from '../../entity/wa-contact.entity';
import { WaConsentStatus } from '../../enum/whatsapp.enum';
import { MetaWhatsAppProvider } from '../../provider/meta-whatsapp.provider';
import { recordedWebhook } from '../../test/fixtures/recorded';
import {
  agentBot,
  ANSWER,
  buildInboundHarness,
} from './whatsapp-inbound-agent.fixtures';

const AGENT_ANSWER = {
  ...ANSWER,
  turn_type: 'question',
  run_id: 'run-1',
  runtime: 'v2',
  trace: [],
};
const BSUID = 'IN.13491208655302741918';

/**
 * WA-A §4 (RC1 §4b): a webhook carrying Meta's business-scoped user ID instead of a phone number
 * is stored, matched and answered, never dropped; a phone-only webhook works as before.
 */
describe('WhatsAppInboundService: business-scoped user IDs (WA-A §4)', () => {
  const contacts = (existing: Partial<WaContact> | null) => {
    const saved: Record<string, unknown>[] = [];
    const repo = {
      findOne: jest.fn(
        async ({ where }: { where: Record<string, unknown> }) => {
          if (!existing) return null;
          if (where.phoneE164 && where.phoneE164 === existing.phoneE164)
            return existing;
          if (where.bsuid && where.bsuid === existing.bsuid) return existing;
          return null;
        },
      ),
      update: jest.fn().mockResolvedValue(undefined),
      create: (row: Record<string, unknown>) => row,
      save: jest.fn(async (row: Record<string, unknown>) => {
        saved.push(row);
        return {
          id: 'contact-new',
          consentStatus: WaConsentStatus.GRANTED,
          messageCount: 4,
          tenantId: null,
          ...row,
        };
      }),
    };
    return { repo, saved };
  };
  const parsed = () =>
    new MetaWhatsAppProvider({ whatsapp: {} } as never).parseInbound(
      recordedWebhook('business-scoped-id'),
    )[0];

  it('a new person known only by their ID: stored by ID, and answered at that ID', async () => {
    const { repo, saved } = contacts(null);
    const h = await buildInboundHarness({
      chatbot: agentBot,
      agentAnswer: AGENT_ANSWER,
      extraProviders: [
        { provide: getRepositoryToken(WaContact), useValue: repo },
      ],
    });
    await h.service.handle(parsed());
    expect(saved[0]).toMatchObject({
      phoneE164: null,
      bsuid: BSUID,
      phoneLast4: '1918',
    });
    expect(h.aiService.runAgent).toHaveBeenCalledTimes(1);
    expect(h.provider.sendText).toHaveBeenCalledTimes(1);
    expect(h.provider.sendText.mock.calls[0][0]).toBe(BSUID);
  });

  it('a returning person matched by their ID alone stays one thread', async () => {
    const { repo, saved } = contacts({
      id: 'contact-1',
      phoneE164: '919876543210',
      bsuid: BSUID,
      phoneLast4: '3210',
      consentStatus: WaConsentStatus.GRANTED,
      messageCount: 4,
    });
    const h = await buildInboundHarness({
      chatbot: agentBot,
      agentAnswer: AGENT_ANSWER,
      extraProviders: [
        { provide: getRepositoryToken(WaContact), useValue: repo },
      ],
    });
    await h.service.handle(parsed());
    expect(saved).toEqual([]);
    // Answered at their number, which Meta knew before.
    expect(h.provider.sendText.mock.calls[0][0]).toBe('919876543210');
  });

  it('a contact found by phone learns the ID when both arrive', async () => {
    const { repo } = contacts({
      id: 'contact-1',
      phoneE164: '919876543210',
      bsuid: null,
      phoneLast4: '3210',
      consentStatus: WaConsentStatus.GRANTED,
      messageCount: 4,
    });
    const h = await buildInboundHarness({
      chatbot: agentBot,
      agentAnswer: AGENT_ANSWER,
      extraProviders: [
        { provide: getRepositoryToken(WaContact), useValue: repo },
      ],
    });
    await h.service.handle({ ...parsed(), from: '919876543210' });
    expect(repo.update).toHaveBeenCalledWith(
      { id: 'contact-1' },
      expect.objectContaining({ bsuid: BSUID }),
    );
    expect(h.provider.sendText.mock.calls[0][0]).toBe('919876543210');
  });

  it('a phone-only webhook works exactly as before', async () => {
    const h = await buildInboundHarness({
      chatbot: agentBot,
      agentAnswer: AGENT_ANSWER,
    });
    await h.service.handle({
      ...parsed(),
      from: '919876543210',
      fromUserId: undefined,
    });
    expect(h.provider.sendText.mock.calls[0][0]).toBe('919876543210');
  });
});
