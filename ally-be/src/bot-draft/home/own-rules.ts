import { SafetyLockedError } from '../safety-pack/safety-lock';
import { packFor } from '../safety-pack/safety-packs';
import { HomeFieldInvalid, versionOf } from './home-fields';

/**
 * The Safety section's two lists (chunk 20d): the pack's rules, fixed, and the owner's own "never"
 * lines on top. Own rules sit after the owner's instructions in the engine's fenced block and can
 * only add to the pack: a pack rule can't be removed or edited from here, or anywhere.
 */

const MAX_OWN_RULES = 20;
const OWN_RULE_MAX_CHARS = 200;

export interface SafetyRule {
  /** `pack-<n>` or `own-<n>`. */
  id: string;
  text: string;
  fixed: boolean;
}

export interface SafetyView {
  pack: {
    id: string;
    name: string;
    industryLabel: string;
    always: string[];
    never: string[];
    atRisk: string[];
  } | null;
  rules: SafetyRule[];
  /** The version of the owner's own rules a change must be based on. */
  version: string;
}

export type RuleChange =
  | { op: 'add'; text: string }
  | { op: 'edit'; id: string; text: string }
  | { op: 'remove'; id: string };

export function safetyView(
  packId: string | null | undefined,
  own: string[],
): SafetyView {
  const pack = packFor(packId);
  return {
    pack: pack
      ? {
          id: pack.id,
          name: pack.name,
          industryLabel: pack.industryLabel,
          always: pack.always,
          never: pack.never,
          atRisk: pack.atRisk,
        }
      : null,
    rules: [
      ...(pack?.never ?? []).map((text, n) => ({
        id: `pack-${n}`,
        text,
        fixed: true,
      })),
      ...own.map((text, n) => ({ id: `own-${n}`, text, fixed: false })),
    ],
    version: versionOf(own),
  };
}

/** The owner's rules after one change. Touching a pack rule is refused as `safety_locked`. */
export function changeOwnRules(own: string[], change: RuleChange): string[] {
  if (change.op !== 'add' && change.id.startsWith('pack-')) {
    throw new SafetyLockedError(
      change.op === 'remove' ? 'pack_rule_removed' : 'pack_rule_edited',
    );
  }
  const index =
    change.op === 'add'
      ? -1
      : Number(/^own-(\d+)$/.exec(change.id)?.[1] ?? NaN);
  if (change.op !== 'add' && !(index >= 0 && index < own.length)) {
    throw new HomeFieldInvalid('That rule is no longer there.');
  }
  if (change.op === 'remove') return own.filter((_, n) => n !== index);

  const text = change.text.trim();
  if (text.length < 3)
    throw new HomeFieldInvalid('Write the rule in a few words.');
  if (text.length > OWN_RULE_MAX_CHARS) {
    throw new HomeFieldInvalid(
      `A rule can be at most ${OWN_RULE_MAX_CHARS} characters.`,
    );
  }
  const same = (a: string) => a.trim().toLowerCase() === text.toLowerCase();
  if (own.some((rule, n) => n !== index && same(rule))) {
    throw new HomeFieldInvalid('You already have this rule.');
  }
  if (change.op === 'edit')
    return own.map((rule, n) => (n === index ? text : rule));
  if (own.length >= MAX_OWN_RULES) {
    throw new HomeFieldInvalid(`Up to ${MAX_OWN_RULES} rules of your own.`);
  }
  return [...own, text];
}
