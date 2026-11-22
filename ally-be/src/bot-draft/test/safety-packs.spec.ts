import { readFileSync } from 'fs';
import { join } from 'path';
import { CareTopic, Industry, SafetyPackId } from '../enum/bot-draft.enum';
import {
  isHealthPack,
  PACK_FOR_INDUSTRY,
  packForBusiness,
  packRulesBlock,
  SAFETY_PACKS,
} from '../safety-pack/safety-packs';

const DECK = readFileSync(
  join(__dirname, '../../../../docs/agents-v2/ONBOARDING-COPY.md'),
  'utf8',
).replace(/\s+/g, ' ');

describe('safety packs', () => {
  it('chooses the pack from the industry, in code', () => {
    expect(PACK_FOR_INDUSTRY[Industry.MENTAL_HEALTH]).toBe(
      SafetyPackId.MENTAL_HEALTH,
    );
    expect(PACK_FOR_INDUSTRY[Industry.GP_CLINIC]).toBe(SafetyPackId.MEDICAL);
    expect(PACK_FOR_INDUSTRY[Industry.DIAGNOSTIC_LAB]).toBe(
      SafetyPackId.MEDICAL,
    );
    expect(PACK_FOR_INDUSTRY[Industry.PHARMACY]).toBe(SafetyPackId.PHARMACY);
    expect(PACK_FOR_INDUSTRY[Industry.COACHING]).toBe(SafetyPackId.MINORS);
    expect(PACK_FOR_INDUSTRY[Industry.D2C]).toBe(SafetyPackId.STANDARD);
    for (const industry of Object.values(Industry)) {
      expect(SAFETY_PACKS[PACK_FOR_INDUSTRY[industry]]).toBeDefined();
    }
  });

  it.each(Object.values(SAFETY_PACKS).map((p) => [p.id, p] as const))(
    "%s speaks to owners in the copy deck's exact words",
    (_id, pack) => {
      expect(DECK).toContain(pack.builderMessage);
      expect(DECK).toContain(pack.name);
      expect(DECK).toContain(pack.industryLabel);
      for (const line of [...pack.always, ...pack.never, ...pack.atRisk]) {
        expect(DECK).toContain(line);
      }
    },
  );

  it('health packs keep the crisis classifier on and a disclaimer; ordering never lets a health pack be weakened', () => {
    for (const id of [
      SafetyPackId.MENTAL_HEALTH,
      SafetyPackId.MEDICAL,
      SafetyPackId.PHARMACY,
    ]) {
      expect(isHealthPack(id)).toBe(true);
      expect(SAFETY_PACKS[id].requiredSettings.crisisClassifierEnabled).toBe(
        true,
      );
      expect(SAFETY_PACKS[id].disclaimer).toBeTruthy();
      expect(SAFETY_PACKS[id].strength).toBeGreaterThan(
        SAFETY_PACKS[SafetyPackId.STANDARD].strength,
      );
    }
  });

  it('builds the fixed rules block the engine adds to every run', () => {
    const block = packRulesBlock(SafetyPackId.MENTAL_HEALTH, [
      'discuss fees for other clinics',
    ])!;
    expect(block).toMatch(/^<safety_rules fixed="true">/);
    expect(block).toContain('Never diagnose');
    expect(block).toContain('- Never: discuss fees for other clinics');
    expect(packRulesBlock(null)).toBeNull();
  });
});

describe('packForBusiness', () => {
  it.each([
    // A mental health non-profit gets Mental health safety from its cause.
    [
      Industry.NON_PROFIT,
      [CareTopic.MENTAL_HEALTH],
      SafetyPackId.MENTAL_HEALTH,
    ],
    [Industry.NON_PROFIT, [], SafetyPackId.STANDARD],
    // The strongest wins, whichever side it comes from.
    [Industry.SCHOOL, [CareTopic.MENTAL_HEALTH], SafetyPackId.MENTAL_HEALTH],
    [
      Industry.MENTAL_HEALTH,
      [CareTopic.YOUNG_PEOPLE],
      SafetyPackId.MENTAL_HEALTH,
    ],
    [Industry.D2C, [CareTopic.MEDICINES], SafetyPackId.PHARMACY],
    [Industry.SAAS, ['astrology'], SafetyPackId.STANDARD],
    ['made_up', [], SafetyPackId.STANDARD],
  ])('%s with %j gets %s', (industry, topics, pack) => {
    expect(packForBusiness(industry, topics as never)).toBe(pack);
  });
});

describe('crisis and emergency replies in the person language (Q3-fast Part 1)', () => {
  const packs = require('../safety-pack/safety-packs');

  it.each(['en', 'hi', 'hi-latn'])(
    'the at-risk reply in %s always has a real number',
    (language) => {
      for (const pack of ['mental_health', 'medical', 'standard', null]) {
        const reply: string = packs.crisisReply({ pack, language });
        expect(reply).toMatch(/14416/);
        expect(reply).not.toMatch(/your local crisis line/);
      }
    },
  );

  it('the emergency reply sends them to emergency care, names the business, and adds Tele-MANAS only with self-harm', () => {
    expect(
      packs.emergencyReply({
        organisation: 'Cloudnine',
        emergencyNumber: '99724 99724',
      }),
    ).toBe(
      'This sounds like an emergency. Please go to the nearest emergency department now, or call 112 or an ambulance on 108. You can also call Cloudnine on 99724 99724.',
    );
    expect(packs.emergencyReply({})).not.toMatch(/14416/);
    expect(packs.emergencyReply({ selfHarm: true })).toMatch(
      /Tele-MANAS on 14416/,
    );
    expect(packs.emergencyReply({ animal: true })).toMatch(
      /^This sounds like an emergency\. Please go to the nearest emergency department or your nearest vet now/,
    );
    // One at-risk reply on every pack (stop 1): Tele-MANAS first, never "if this is an emergency".
    expect(packs.crisisReply({ pack: 'medical' })).toBe(
      packs.GENERAL_CRISIS_TEXT,
    );
    expect(packs.crisisReply({ pack: 'medical', language: 'hi' })).toMatch(
      /^लगता है कि यह गंभीर स्थिति हो सकती है।/,
    );
    expect(packs.emergencyReply({ language: 'hi-latn' })).toMatch(
      /^Yeh emergency lagti hai\. .*112 .*108/,
    );
  });
});

describe('newHelplines (chunk H1)', () => {
  const { newHelplines } = require('../safety-pack/safety-packs');
  it('drops a helpline the reply already gives, keeps the rest', () => {
    const already = 'call Tele-MANAS on 14416 (free, 24×7), or 112';
    expect(newHelplines('Tele-MANAS 14416', already)).toBe('');
    expect(
      newHelplines('Tele-MANAS 14416, Vandrevala 9999 666 555', already),
    ).toBe('Vandrevala 9999 666 555');
    expect(newHelplines('', already)).toBe('');
  });
});

describe('a health industry keeps its own pack (Q4 A2)', () => {
  it('a maternity hospital with a psychology service stays Medical', () => {
    expect(packForBusiness('gp_clinic', ['mental_health', 'medical'])).toBe(
      'medical',
    );
  });
  it('a therapy practice that mentions medicines stays Mental health', () => {
    expect(packForBusiness('mental_health', ['medicines'])).toBe(
      'mental_health',
    );
  });
});
