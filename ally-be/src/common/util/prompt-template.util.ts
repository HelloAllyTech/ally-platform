import * as fs from 'fs';
import * as path from 'path';
import { LoggerService } from 'src/logger/logger.service';

/**
 * Loading a system prompt that lives in the Skills Store, for a call site that
 * must not run without one.
 *
 * `PromptSharedService.getPromptByCode` already walks live version → stored
 * default → file on disk. What it cannot do is survive the database being
 * unreachable: it throws. Builder's loaders (`loadPlatformRules`, the
 * interviewer's system prompt) degrade instead of failing a build an hour in,
 * and this does the same with one difference: rather than a second compiled
 * copy of the text that drifts from the file, the fallback IS the shipped
 * default in `src/prompts/` — a minimal working base, not production's text —
 * trimmed exactly as sync stores it. When neither exists it throws, so a call never
 * goes out with an empty system prompt.
 */

/** Anything that can look a prompt up by code. `PromptSharedService` is one. */
export interface PromptLookup {
  getPromptByCode(promptCode: string): Promise<string | null>;
  getPromptLlmConfig?(
    promptCode: string,
  ): Promise<{ provider?: string; model?: string; temperature?: number }>;
}

const PROMPTS_DIR = 'src/prompts';

/** Code → file, built on first use (never at module load). */
let shippedIndex: Map<string, string> | null = null;

function indexShippedPrompts(): Map<string, string> {
  const index = new Map<string, string>();
  const root = path.join(process.cwd(), PROMPTS_DIR);
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.txt')) {
        // The same path → code rule sync uses.
        const code = path
          .relative(root, full)
          .replace(/\.txt$/, '')
          .replace(/[/\\]/g, '_');
        index.set(code, full);
      }
    }
  };
  walk(root);
  return index;
}

/**
 * A prompt's shipped default, trimmed as sync stores it, or null when the
 * repo has no file for that code.
 */
export function shippedPromptDefault(promptCode: string): string | null {
  shippedIndex ??= indexShippedPrompts();
  const file = shippedIndex.get(promptCode);
  if (!file) return null;
  try {
    return fs.readFileSync(file, 'utf8').trim() || null;
  } catch {
    return null;
  }
}

/**
 * The prompt's live text from the Skills Store; its shipped default when the
 * store can't be read or has nothing for it. Never empty: throws when there is
 * no text anywhere, so the caller's own failure path runs instead of a model
 * call with no instructions.
 */
export async function loadPromptTemplate(
  prompts: PromptLookup | null | undefined,
  promptCode: string,
): Promise<string> {
  if (prompts) {
    try {
      const text = await prompts.getPromptByCode(promptCode);
      if (text?.trim()) return text;
    } catch (error) {
      LoggerService.getInstance('PromptTemplate').warn(
        `Could not load "${promptCode}" from the Skills Store, using its shipped default: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  const shipped = shippedPromptDefault(promptCode);
  if (shipped) return shipped;
  throw new Error(
    `Prompt "${promptCode}" has no text in the Skills Store and no shipped default.`,
  );
}

/**
 * The model a prompt's row names in the Skills Store, if any. Empty when it
 * names none or the store can't be read — the caller's configured model then
 * applies, as it did before the prompt had a row.
 */
export async function promptModelChoice(
  prompts: PromptLookup | null | undefined,
  promptCode: string,
): Promise<{ provider?: string; model?: string }> {
  if (!prompts?.getPromptLlmConfig) return {};
  try {
    const config = await prompts.getPromptLlmConfig(promptCode);
    const model = config?.model?.trim();
    if (!model) return {};
    return { model, provider: config.provider?.trim() || undefined };
  } catch {
    return {};
  }
}

/**
 * For a call that names its own configured model: the completion fields that
 * let the prompt's model win when the Skills Store sets one, and leave the
 * configured model in place otherwise. `promptCode` also carries the prompt's
 * temperature.
 */
export async function promptModelOr(
  prompts: PromptLookup | null | undefined,
  promptCode: string,
  configuredModel: string,
): Promise<{ promptCode: string; model: string; provider?: string }> {
  const choice = await promptModelChoice(prompts, promptCode);
  return choice.model
    ? {
        promptCode,
        model: choice.model,
        ...(choice.provider ? { provider: choice.provider } : {}),
      }
    : { promptCode, model: configuredModel };
}
