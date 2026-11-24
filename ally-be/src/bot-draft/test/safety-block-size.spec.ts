import { EXTRA_NEVER_LIMITS } from '../service/draft-change.service';
import {
  SAFETY_PACKS,
  SAFETY_RULES_MAX_CHARS,
  packRulesBlock,
} from '../safety-pack/safety-packs';

/**
 * 24 Nov: the Medical pack's block grew past ally-ai's 3,000-character limit on
 * `persona.safety_rules` (SB1's base and minors lines), so ally-ai refused every run of a Medical
 * assistant with a 422 and it could answer nothing but crisis messages. Every pack's longest block,
 * with an owner's full allowance of Never rules, must fit what ally-ai accepts.
 */
describe('the safety block always fits what ally-ai accepts', () => {
  const ownerRules = Array.from({ length: EXTRA_NEVER_LIMITS.rules }, () =>
    'x'.repeat(EXTRA_NEVER_LIMITS.chars),
  );

  it.each([...Object.keys(SAFETY_PACKS), null])('%s', (id) => {
    const block = packRulesBlock(id, ownerRules, {
      helpline: 'Tele-MANAS 14416, 9152987821, +91 22 2552 1111',
      hasCreateTool: true,
      audienceAge: 'unstated',
    });
    expect(block.length).toBeLessThan(SAFETY_RULES_MAX_CHARS);
  });

  it('the Medical pack alone is past the old 3,000 limit', () => {
    expect(
      packRulesBlock('medical', [], { audienceAge: 'unstated' }).length,
    ).toBeGreaterThan(3_000);
  });
});
