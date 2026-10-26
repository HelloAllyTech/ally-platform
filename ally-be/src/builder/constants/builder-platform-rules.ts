import { LoggerService } from 'src/logger/logger.service';
import { BUILDER_PROMPTS } from './builder.constants';

/**
 * The platform rules: what holds for every change on Ally, given to every
 * Builder agent — the interviewer, the technical designer and its critic, the
 * planner, coder, verifier, remediator, finaliser, fixer and reviewer.
 *
 * Hand-written and authoritative, which is what separates them from lessons:
 * a lesson is learned from one run and advisory, a rule is a constraint the
 * platform cannot ship without. The one that made them necessary is the first
 * — session 880e73e6 (2026-10-12) shipped a plan that renamed a persisted JSON
 * key, and every released mobile build reading the old key broke. Nothing any
 * agent was told said released clients lag the backend.
 *
 * `builder_platform_rules` is the source of truth and ships as
 * src/prompts/builder/platform_rules.txt carrying this same text. This copy is
 * the fallback for a missing row or an unreachable database, so the rules
 * degrade to what shipped rather than to nothing — an agent that has quietly
 * lost "never rename a persisted key" still runs, and is simply dangerous.
 */
export const DEFAULT_PLATFORM_RULES = `## Platform rules

- Changes to anything a released client reads are additive: never rename, remove or retype a field, enum value or persisted JSON key.
- Find every reader of a field before changing it.
- Reuse existing components; stay in scope; every requirement gets a test.
- Every ally-be query is tenant-isolated.
- Docs move with code.`;

/** Anything that can look a prompt up by code. */
interface PromptLookup {
  getPromptByCode(promptCode: string): Promise<string | null>;
}

/**
 * The rules as prompt management has them, or the compiled default.
 *
 * Never an empty string, and never throws: an outage in prompt management
 * must not fail a build already an hour in, and a blank rules block is the
 * failure nobody notices.
 */
export async function loadPlatformRules(
  prompts: PromptLookup | null | undefined,
): Promise<string> {
  if (!prompts) return DEFAULT_PLATFORM_RULES;
  try {
    const text = await prompts.getPromptByCode(BUILDER_PROMPTS.PLATFORM_RULES);
    if (text?.trim()) return text.trim();
  } catch (error) {
    // Resolved here rather than at module load: this file is imported by
    // every phase prompt, and load-time work in a shared module is what
    // breaks unrelated suites.
    LoggerService.getInstance('BuilderPlatformRules').warn(
      `Could not load "${BUILDER_PROMPTS.PLATFORM_RULES}", using the compiled default: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  return DEFAULT_PLATFORM_RULES;
}

/**
 * The rules as a prompt section, for every phase prompt's top.
 *
 * One renderer so the block reads identically in every phase and stays in the
 * cacheable prefix. An absent value falls back to the default rather than to
 * nothing, for the same reason the loader never returns empty.
 */
export function renderPlatformRules(rules?: string | null): string {
  return (rules?.trim() || DEFAULT_PLATFORM_RULES).trim();
}
