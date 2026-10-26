import { createHash } from 'crypto';
import { PromptContract } from '../entity/prompt.entity';

/**
 * sha256 hex of the trimmed body: the hash sessions record as the text that
 * ran, and the `sourceHash` translations are keyed by. Trimmed so a trailing
 * newline never makes two identical prompts look different.
 */
export function hashPromptBody(body: string): string {
  return createHash('sha256').update(body.trim(), 'utf8').digest('hex');
}

/**
 * `{name}` placeholders in a body (also catches the inner name of `{{name}}`).
 * Angle brackets are deliberately not read here: prose and markup use them,
 * and a contract check must not refuse a body for writing `<b>`.
 */
export function placeholdersIn(body: string): string[] {
  const names = new Set<string>();
  for (const m of body.matchAll(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g)) {
    names.add(m[1]);
  }
  return [...names].sort();
}

export interface ContractViolation {
  /** Required placeholders the body doesn't contain. */
  missing: string[];
  /** Placeholders the body uses that the code never supplies. */
  unknown: string[];
}

/**
 * Check a body against its prompt's contract. Returns null when it satisfies
 * the contract or when no contract is declared yet.
 */
export function checkContract(
  body: string,
  contract: PromptContract | null | undefined,
): ContractViolation | null {
  if (!contract) return null;
  const used = new Set(placeholdersIn(body));
  const missing = (contract.required ?? []).filter((v) => !used.has(v));
  const declared = contract.variables ? new Set(contract.variables) : null;
  const unknown = declared ? [...used].filter((v) => !declared.has(v)) : [];
  return missing.length || unknown.length ? { missing, unknown } : null;
}

export function describeViolation(v: ContractViolation): string {
  const parts: string[] = [];
  if (v.missing.length) {
    parts.push(`missing required ${v.missing.map((n) => `{${n}}`).join(', ')}`);
  }
  if (v.unknown.length) {
    parts.push(
      `uses ${v.unknown.map((n) => `{${n}}`).join(', ')}, which the code doesn't supply`,
    );
  }
  return parts.join('; ');
}
