import type { PackChange } from '../../chatbot/entity/chatbot.entity';
import { SafetyLockedError } from '../safety-pack/safety-lock';
import { packFor, SAFETY_PACKS } from '../safety-pack/safety-packs';
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
  /**
   * The packs the owner may choose from (Q3-fast Part 1, "This isn't right for my business"),
   * each marked less strict than the current one or not.
   */
  choices: { id: string; name: string; summary: string; lessStrict: boolean }[];
  /** The owner's last change of the pack, if any. */
  packChange: PackChange | null;
}

export type RuleChange =
  | { op: 'add'; text: string }
  | { op: 'edit'; id: string; text: string }
  | { op: 'remove'; id: string };

export function safetyView(
  packId: string | null | undefined,
  own: string[],
  packChange: PackChange | null = null,
): SafetyView {
  const pack = packFor(packId);
  return {
    choices: Object.values(SAFETY_PACKS)
      // Pharmacy shares Medical's name for owners; it stays reachable only through setup.
      .filter((p) => p.id !== 'pharmacy')
      .map((p) => ({
        id: p.id,
        name: p.name,
        summary: p.summary,
        lessStrict: Boolean(pack && p.strength < pack.strength),
      })),
    packChange,
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
