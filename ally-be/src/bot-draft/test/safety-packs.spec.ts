import { readFileSync } from 'fs';
import { join } from 'path';
import { Industry, SafetyPackId } from '../enum/bot-draft.enum';
import {
  isHealthPack,
  PACK_FOR_INDUSTRY,
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
