import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { PromptsRepository } from '../repository/prompt.repository';
import {
  PromptSearchOptions,
  PromptsWithPromptCode,
  ResolvedPrompt,
} from '../type/prompt-response.type';
import { hashPromptBody } from '../util/prompt-contract.util';

const PROMPTS_DIR = 'src/prompts';

/**
 * How long a resolved prompt is reused before the store is read again. A
 * publish therefore reaches every ally-be process within this window (at once
 * in the process that published it, which drops its cached copy).
 * PROMPT_CACHE_TTL_MS=0 turns caching off, e.g. for local work.
 */
const DEFAULT_PROMPT_CACHE_TTL_MS = 60_000;

@Injectable()
export class PromptSharedService {
  private readonly cache = new Map<
    string,
    { value: ResolvedPrompt | null; expires: number }
  >();

  constructor(private readonly promptsRepository: PromptsRepository) {}

  private get cacheTtlMs(): number {
    const raw = Number(process.env.PROMPT_CACHE_TTL_MS);
    return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_PROMPT_CACHE_TTL_MS;
  }

  /** Drop a prompt's cached copy (or every one), e.g. after a publish. */
  invalidate(promptCode?: string): void {
    if (promptCode) this.cache.delete(promptCode);
    else this.cache.clear();
  }

  /**
   * The live text of a prompt, by code: its live version in the store. The
   * default text (Git, synced to `defaultPrompt`) is used only when the row has
   * no live version, and the file on disk only when there is no row at all —
   * a prompt that has never been synced. Returns null if none of them exists.
   */
  async getPromptByCode(promptCode: string): Promise<string | null> {
    return (await this.resolvePrompt(promptCode))?.prompt ?? null;
  }

  /**
   * The live text AND model settings of a prompt in one lookup, plus what
   * identifies the text that ran (version + content hash). Callers that need
   * both text and settings use this so a publish between two separate lookups
   * can't pair text and settings from different versions.
   */
  async resolvePrompt(promptCode: string): Promise<ResolvedPrompt | null> {
    const ttl = this.cacheTtlMs;
    const hit = ttl ? this.cache.get(promptCode) : undefined;
    if (hit && hit.expires > Date.now()) return hit.value;
    const value = await this.resolveFromStore(promptCode);
    if (ttl) this.cache.set(promptCode, { value, expires: Date.now() + ttl });
    return value;
  }

  private async resolveFromStore(
    promptCode: string,
  ): Promise<ResolvedPrompt | null> {
    const row = (await this.promptsRepository
      .createQueryBuilder('prompt')
      .leftJoin(
        'prompts_versions',
        'pv',
        '"prompt"."id" = "pv"."promptId" AND "pv"."version" = "prompt"."currentVersion"',
      )
      .select('pv.prompt', 'prompt')
      .addSelect('pv.version', 'version')
      .addSelect('pv.provider', 'provider')
      .addSelect('pv.model', 'model')
      .addSelect('CAST(pv.temperature AS double precision)', 'temperature')
      .addSelect('prompt.defaultPrompt', 'defaultPrompt')
      .addSelect('prompt.provider', 'rowProvider')
      .addSelect('prompt.model', 'rowModel')
      .addSelect(
        'CAST(prompt.temperature AS double precision)',
        'rowTemperature',
      )
      .where('prompt.promptCode = :promptCode', { promptCode })
      .getRawOne()) as
      | {
          prompt?: string | null;
          version?: number | null;
          provider?: string | null;
          model?: string | null;
          temperature?: number | null;
          defaultPrompt?: string | null;
          rowProvider?: string | null;
          rowModel?: string | null;
          rowTemperature?: number | null;
        }
      | undefined;

    const settings = (r: NonNullable<typeof row>) => ({
      provider: r.provider ?? r.rowProvider ?? undefined,
      model: r.model ?? r.rowModel ?? undefined,
      temperature:
        typeof (r.temperature ?? r.rowTemperature) === 'number'
          ? ((r.temperature ?? r.rowTemperature) as number)
          : undefined,
    });

    if (row?.prompt?.trim()) {
      return {
        promptCode,
        prompt: row.prompt,
        version: row.version ?? null,
        contentHash: hashPromptBody(row.prompt),
        source: 'store',
        ...settings(row),
      };
    }
    const fallback = row?.defaultPrompt?.trim()
      ? row.defaultPrompt
      : await this.readFromFolder(promptCode);
    if (!fallback) return null;
    return {
      promptCode,
      prompt: fallback,
      version: null,
      contentHash: hashPromptBody(fallback),
      source: 'default',
      ...(row ? settings(row) : {}),
    };
  }

  /**
   * Resolve promptCode to file path. Supports:
   * - Flat: promptCode.txt (legacy)
   * - Subdir: subdir/rest.txt when promptCode = subdir_rest (e.g. openai_simulation_foo -> openai_simulation/foo.txt)
   */
  private async readFromFolder(promptCode: string): Promise<string | null> {
    const promptsDir = path.join(process.cwd(), PROMPTS_DIR);
    try {
      try {
        await fs.promises.stat(promptsDir);
      } catch {
        return null;
      }

      // Try flat first (backward compat)
      const flatPath = path.join(promptsDir, `${promptCode}.txt`);
      try {
        await fs.promises.stat(flatPath);
        const content = await fs.promises.readFile(flatPath, 'utf-8');
        return content.trim();
      } catch {
        // Flat file not found, try subdir
      }

      // Try subdirs: promptCode subdir_rest -> subdir/rest.txt
      const entries = await fs.promises.readdir(promptsDir, {
        withFileTypes: true,
      });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const prefix = entry.name.replace(/-/g, '_');
        if (promptCode.startsWith(prefix + '_')) {
          const rest = promptCode.slice(prefix.length + 1);
          const subdirPath = path.join(promptsDir, entry.name, `${rest}.txt`);
          try {
            await fs.promises.stat(subdirPath);
            const content = await fs.promises.readFile(subdirPath, 'utf-8');
            return content.trim();
          } catch {
            // Subdir file not found
          }
        }
      }
    } catch {
      // Ignore read errors
    }
    return null;
  }

  /**
   * Get prompts by options.
   * Returns an array of prompts with prompt code.
   *
   * @param options - The options to filter prompts by.
   * example options: { promptCode: ['ally_ai_learn_default']}
   * @returns An array of prompts with prompt code.
   */
  /**
   * Prompt-level LLM override for a single prompt code: `{ model, temperature }`
   * read from the prompts row. Both undefined when unset or the prompt has no
   * row. Used by ally-be's own LLM call sites (coaching chat, tooltip
   * translation, autofill, copilot) to honor a per-prompt model/temperature.
   * A caller that also needs the text should use `resolvePrompt`, which returns
   * both from one lookup.
   */
  async getPromptLlmConfig(
    promptCode: string,
  ): Promise<{ provider?: string; model?: string; temperature?: number }> {
    const resolved = await this.resolvePrompt(promptCode);
    return {
      provider: resolved?.provider || undefined,
      model: resolved?.model || undefined,
      temperature:
        typeof resolved?.temperature === 'number'
          ? resolved.temperature
          : undefined,
    };
  }

  async getPromptsByOptions(
    options: PromptSearchOptions,
  ): Promise<Array<PromptsWithPromptCode>> {
    const query = this.promptsRepository
      .createQueryBuilder('prompt')
      .leftJoin(
        'prompts_versions',
        'pv',
        '"prompt"."id" = "pv"."promptId" AND "pv"."version" = "prompt"."currentVersion"',
      )
      .select(['pv.prompt AS prompt', 'prompt.promptCode AS "promptCode"'])
      .addSelect('prompt.useDashboardOverride', 'useDashboardOverride')
      .addSelect('prompt.availableVariables', 'availableVariables')
      .addSelect('prompt.hasStates', 'hasStates')
      .addSelect('prompt.provider', 'provider')
      .addSelect('prompt.model', 'model')
      .addSelect('prompt.temperature', 'temperature')
      .addSelect('prompt.defaultPrompt', 'defaultPrompt')
      .addSelect('prompt.currentVersion', 'currentVersion');
    // Model settings come from the live version, which the row mirrors on
    // every promotion; the row's values cover rows with no version yet.

    if (options.promptCode && options.promptCode.length > 0) {
      query.andWhere('prompt.promptCode IN (:...promptCodes)', {
        promptCodes: options.promptCode,
      });
    }
    if (options.promptCodePrefix) {
      query.andWhere('prompt.promptCode LIKE :prefix', {
        prefix: `${options.promptCodePrefix}%`,
      });
    }

    const rows = await query.getRawMany<
      PromptsWithPromptCode & {
        useDashboardOverride: boolean;
        availableVariables?: (
          | string
          | { name: string; label?: string; required?: boolean }
        )[];
        hasStates?: boolean;
        defaultPrompt?: string;
        currentVersion?: number;
      }
    >();

    for (const row of rows) {
      // Raw query returns the numeric `temperature` column as a string; coerce
      // to a number so the runtime payload carries a real number (or undefined).
      const rawTemp = row.temperature as unknown;
      row.temperature =
        rawTemp === null || rawTemp === undefined || rawTemp === ''
          ? undefined
          : parseFloat(rawTemp as string);
      if (!row.prompt?.trim() && row.defaultPrompt?.trim()) {
        // No live version yet: serve the default text from Git.
        row.prompt = row.defaultPrompt;
        row.version = null;
      } else {
        row.version = row.currentVersion ?? null;
      }
      row.contentHash = row.prompt ? hashPromptBody(row.prompt) : undefined;
    }

    return rows;
  }
}
