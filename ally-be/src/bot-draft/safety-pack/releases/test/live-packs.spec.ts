import { DEFAULT_WHATSAPP_SETTINGS } from '../../../../whatsapp/type/whatsapp-settings.type';
import { usageHeaders } from '../../../../billing/context/usage-context';
import { usageContext } from '../../../../billing/context/usage-context';
import {
  ALLY_PAID_USAGE_KINDS,
  UsageChannel,
  UsageKind,
} from '../../../../billing/enum/billing.enum';
import type { ChatTurn } from '../../../../chatbot/engine/chatbot-engine.types';
import { usageContextFor } from '../../../../chatbot/engine/engine-usage';
import { buildKnowledgeRequest } from '../../../../chatbot/engine/knowledge-request';
import { chatbotFixture } from '../../../../chatbot/engine/test/engine.fixtures';
import { SafetyPackId } from '../../../enum/bot-draft.enum';
import {
  clearLivePacks,
  setLivePacks,
  withPackOverride,
} from '../../live-packs';
import {
  codePackFor,
  packFor,
  packRulesBlock,
  SAFETY_PACKS,
} from '../../safety-packs';

const KNOWLEDGE = { audience: { unrestricted: true }, document_ids: ['d'] };
const turn = (safetyPack: string | null): ChatTurn => ({
  chatbot: chatbotFixture({ safetyPack } as never),
  settings: DEFAULT_WHATSAPP_SETTINGS,
  text: 'hello',
  history: [],
  sender: { externalId: '919876543210', label: '…3210' },
  channel: { type: 'test' },
});

const RELEASED_RULE = 'Released rule: always offer the clinic line.';
const released = {
  ...SAFETY_PACKS[SafetyPackId.MEDICAL],
  version: 7,
  rules: [RELEASED_RULE],
};

/** Stage 9: the engine reads a pack's current release, with the code pack as the fallback. */
describe('safety packs read from their current release', () => {
  afterEach(() => clearLivePacks());

  it('falls back to the code constants when no release is loaded', () => {
    expect(packFor(SafetyPackId.MEDICAL)).toBe(
      SAFETY_PACKS[SafetyPackId.MEDICAL],
    );
    const body = buildKnowledgeRequest(
      turn(SafetyPackId.MEDICAL),
      {},
      KNOWLEDGE,
    );
    for (const line of SAFETY_PACKS[SafetyPackId.MEDICAL].rules)
      expect(body.persona?.safety_rules).toContain(line);
  });

  it('serves the current release to the engine once loaded', () => {
    setLivePacks([{ releaseId: 'r7', version: 7, pack: released }]);
    expect(packFor(SafetyPackId.MEDICAL)?.version).toBe(7);
    expect(codePackFor(SafetyPackId.MEDICAL)).toBe(
      SAFETY_PACKS[SafetyPackId.MEDICAL],
    );
    const body = buildKnowledgeRequest(
      turn(SafetyPackId.MEDICAL),
      {},
      KNOWLEDGE,
    );
    expect(body.persona?.safety_rules).toContain(RELEASED_RULE);
    // Other packs keep their code content; the base block is always there.
    expect(packFor(SafetyPackId.PHARMACY)).toBe(
      SAFETY_PACKS[SafetyPackId.PHARMACY],
    );
    expect(body.persona?.safety_rules).toContain(
      'Never say or suggest that you are a human',
    );
  });

  it('goes back to the code pack when the releases are cleared (kill switch)', () => {
    setLivePacks([{ releaseId: 'r7', version: 7, pack: released }]);
    clearLivePacks();
    expect(packRulesBlock(SafetyPackId.MEDICAL)).not.toContain(RELEASED_RULE);
  });

  it('a draft under test is injected whatever pack the test chatbot has', async () => {
    const draft = { ...released, rules: ['Draft rule under test.'] };
    const body = await withPackOverride(
      { packId: SafetyPackId.MEDICAL, pack: draft },
      async () => buildKnowledgeRequest(turn(null), {}, KNOWLEDGE),
    );
    expect(body.persona?.safety_rules).toContain('Draft rule under test.');
    expect(body.persona?.safety_pack).toBe(SafetyPackId.MEDICAL);
    // Outside the override nothing changed.
    expect(packRulesBlock(SafetyPackId.MEDICAL)).not.toContain(
      'Draft rule under test.',
    );
  });
});

describe('the pack suite is Ally-paid', () => {
  it('records every call as pack_suite with no creator and no payer, through the engine turn', () => {
    expect(ALLY_PAID_USAGE_KINDS.has(UsageKind.PACK_SUITE)).toBe(true);
    const header = usageContext.run(
      {
        channel: UsageChannel.OWNER,
        runKind: UsageKind.PACK_SUITE,
        allyPaidKind: UsageKind.PACK_SUITE,
        chatbotId: '00000000-0000-0000-0000-000000000001',
      },
      () =>
        // The checkup sets its own kind, then the engine builds the turn's context.
        usageContext.with(
          { runKind: UsageKind.CHECKUP, channel: UsageChannel.OWNER },
          () => {
            const engine = usageContextFor({
              ...turn(null),
              chatbot: chatbotFixture({ createdBy: 42 } as never),
            });
            return usageContext.run(
              { ...engine, payerAccountId: 'acct' },
              () => ({
                run: usageHeaders('api/v1/agent/run'),
                grade: usageHeaders('api/v1/checkup/grade'),
                crisis: usageHeaders('api/v1/knowledge-agent/crisis-check'),
              }),
            );
          },
        ),
    );
    for (const value of Object.values(header)) {
      const payload = JSON.parse(value['X-Ally-Usage']);
      expect(payload.kind).toBe('pack_suite');
      expect(payload.creator_user_id).toBeNull();
      expect(payload.payer_account_id).toBeUndefined();
    }
  });
});
