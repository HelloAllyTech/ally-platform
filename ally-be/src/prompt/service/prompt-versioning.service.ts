import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { Prompt } from '../entity/prompt.entity';
import {
  PromptVersion,
  PromptVersionSource,
} from '../entity/prompt-version.entity';
import { PromptTranslation } from '../entity/prompt-translation.entity';
import { PromptTranslationService } from './prompt-translation.service';
import {
  PROMPT_VERSION_HISTORY_LIMIT,
  TRANSLATABLE_PROMPT_TYPES,
} from '../constants/prompt.constants';
import {
  checkContract,
  describeViolation,
  hashPromptBody,
  placeholdersIn,
} from '../util/prompt-contract.util';
import { reconcileAvailableVariables } from '../util/normalize-available-variable.util';
import {
  BUILDER_EVAL_GATE_REFUSAL,
  isBuilderEvalGatedPrompt,
} from 'src/builder/constants/builder-eval-gate.constants';
import { LoggerService } from 'src/logger/logger.service';
import { JUDGE_RUBRIC_PROMPT_CODES } from '../constants/judge-rubric.constants';

/** Error codes a writer can branch on; each rides on the response body as `code`. */
export const SKILLS_STORE_ERROR = {
  STALE_BASE: 'stale_base',
  CONTRACT_VIOLATION: 'contract_violation',
  TRANSLATIONS_PENDING: 'translations_pending',
  JUDGE_RUBRIC_PINNED: 'judge_rubric_pinned',
  NOT_A_CANDIDATE: 'not_a_candidate',
} as const;

export interface CreateVersionInput {
  body: string;
  /**
   * The newest version the writer started from. The store refuses the write
   * when anything newer exists, so nobody overwrites a version they never saw.
   * `null` only for a prompt with no versions at all.
   */
  baseVersion: number | null;
  provider?: string | null;
  model?: string | null;
  temperature?: number | null;
  source: PromptVersionSource;
  note?: string | null;
  evalSummary?: Record<string, unknown> | null;
  createdBy?: number | null;
  /** Set only by Builder's replay eval for a candidate that passed. */
  evalApproved?: boolean;
}

export interface TranslationReadiness {
  /** False when the prompt isn't translated at all. */
  translatable: boolean;
  ready: number[];
  failed: Array<{ languageId: number; error?: string | null }>;
  pending: number[];
}

export interface PromoteResult {
  promptId: string;
  version: number;
  previousVersion: number | null;
  /** Languages whose translation failed: they keep serving English. */
  failedLanguages: Array<{ languageId: number; error?: string | null }>;
}

export interface VersionSummary {
  version: number;
  status: 'live' | 'candidate' | 'history';
  prompt: string;
  provider: string | null;
  model: string | null;
  temperature: number | null;
  contentHash: string;
  source: string | null;
  note: string | null;
  evalSummary: Record<string, unknown> | null;
  createdBy: number | null;
  createdAt: Date;
  publishedAt: Date | null;
  translations?: TranslationReadiness;
}

/**
 * The one write path for prompt text. Every writer — the Skills Store editor,
 * the `prompts` CLI, skill experiments, Builder's eval, revert — creates a
 * version here and goes live through `promote`.
 *
 * - `createVersion` adds a candidate. It never changes what is served.
 * - `promote` moves the live pointer, atomically, and only once the
 *   candidate's translations are settled (ready, or failed and reported).
 *
 * Both lock the prompt row (`SELECT … FOR UPDATE`) inside one transaction, so
 * two writers can't both claim the same version number and the loser gets a
 * `409 stale_base` instead of a unique-index 500.
 */
@Injectable()
export class PromptVersioningService {
  private readonly logger = LoggerService.getInstance(
    PromptVersioningService.name,
  );

  constructor(
    private readonly dataSource: DataSource,
    private readonly promptTranslationService: PromptTranslationService,
  ) {}

  async createVersion(
    promptId: string,
    input: CreateVersionInput,
    options: { translate?: 'background' | 'none' } = {},
  ): Promise<PromptVersion> {
    const body = input.body?.trim();
    if (!body) {
      throw new BadRequestException('A version needs a non-empty prompt body.');
    }

    const created = await this.dataSource.transaction(async (manager) => {
      const prompt = await this.lockPrompt(manager, promptId);

      if (
        !input.evalApproved &&
        isBuilderEvalGatedPrompt(prompt.promptCode) &&
        input.source !== PromptVersionSource.SYNC &&
        input.source !== PromptVersionSource.IMPORT
      ) {
        throw new ConflictException(BUILDER_EVAL_GATE_REFUSAL);
      }

      const latest = await this.latestVersionNumber(manager, promptId);
      if ((input.baseVersion ?? null) !== latest) {
        throw new ConflictException({
          statusCode: 409,
          code: SKILLS_STORE_ERROR.STALE_BASE,
          message:
            `This prompt has changed since version ${input.baseVersion ?? 'none'}: ` +
            `the newest version is now ${latest ?? 'none'}. Pull it, merge your change, and try again.`,
          latestVersion: latest,
          currentVersion: prompt.currentVersion ?? null,
        });
      }

      const violation = checkContract(body, prompt.contract);
      if (violation) {
        throw new UnprocessableEntityException({
          statusCode: 422,
          code: SKILLS_STORE_ERROR.CONTRACT_VIOLATION,
          message: `This text breaks the prompt's contract: ${describeViolation(violation)}.`,
          ...violation,
        });
      }

      const version = manager.create(PromptVersion, {
        promptId,
        version: (latest ?? 0) + 1,
        prompt: body,
        provider: input.provider ?? null,
        model: input.model ?? null,
        temperature: input.temperature ?? null,
        contentHash: hashPromptBody(body),
        source: input.source,
        note: input.note ?? null,
        evalSummary: input.evalSummary ?? null,
        createdBy: input.createdBy ?? 0,
        updatedBy: input.createdBy ?? 0,
        publishedAt: null,
      });
      return manager.save(PromptVersion, version);
    });

    if ((options.translate ?? 'background') === 'background') {
      this.translateInBackground(promptId, created);
    }
    return created;
  }

  /**
   * Make `version` the live version. `expectedCurrentVersion` is the live
   * version the caller saw; a promotion racing another one is refused.
   *
   * Refused while any translation of the candidate is still pending. A failed
   * translation does not block: that language keeps serving English and the
   * failure comes back in the result so the caller can report it and retry.
   */
  async promote(
    promptId: string,
    version: number,
    expectedCurrentVersion: number | null,
    options: {
      evalApproved?: boolean;
      allowRollback?: boolean;
      /** False only for an import, which brings its translations with it. */
      requireTranslations?: boolean;
      /** Confirms the judge's pinned label was bumped (judge rubrics only). */
      confirmJudgeRubricChange?: boolean;
    } = {},
  ): Promise<PromoteResult> {
    return this.dataSource.transaction(async (manager) => {
      const prompt = await this.lockPrompt(manager, promptId);
      if (
        !options.evalApproved &&
        isBuilderEvalGatedPrompt(prompt.promptCode)
      ) {
        throw new ConflictException(BUILDER_EVAL_GATE_REFUSAL);
      }
      const current = prompt.currentVersion ?? null;
      if ((expectedCurrentVersion ?? null) !== current) {
        throw new ConflictException({
          statusCode: 409,
          code: SKILLS_STORE_ERROR.STALE_BASE,
          message: `The live version changed to ${current ?? 'none'} while you were looking at ${expectedCurrentVersion ?? 'none'}. Refresh and try again.`,
          latestVersion: await this.latestVersionNumber(manager, promptId),
          currentVersion: current,
        });
      }
      const target = await manager.findOne(PromptVersion, {
        where: { promptId, version },
      });
      if (!target) {
        throw new NotFoundException(`Version ${version} not found.`);
      }
      if (target.version === current) {
        return {
          promptId,
          version,
          previousVersion: current,
          failedLanguages: [],
        };
      }
      if (
        target.publishedAt &&
        !options.allowRollback &&
        target.version < (current ?? 0)
      ) {
        throw new ConflictException({
          statusCode: 409,
          code: SKILLS_STORE_ERROR.NOT_A_CANDIDATE,
          message: `Version ${version} was live before. Roll back explicitly to serve it again.`,
        });
      }

      if (
        JUDGE_RUBRIC_PROMPT_CODES.has(prompt.promptCode) &&
        !options.confirmJudgeRubricChange
      ) {
        throw new ConflictException({
          statusCode: 409,
          code: SKILLS_STORE_ERROR.JUDGE_RUBRIC_PINNED,
          message:
            `${prompt.promptCode} is a judge rubric. Its results are labelled by a version pinned in code, ` +
            'so bump the judge’s PROMPT_VERSION (and the backlog drainer’s target) in the same change, then confirm.',
        });
      }

      const readiness = await this.readinessWith(manager, prompt, target);
      if (
        options.requireTranslations !== false &&
        readiness.translatable &&
        readiness.pending.length
      ) {
        throw new ConflictException({
          statusCode: 409,
          code: SKILLS_STORE_ERROR.TRANSLATIONS_PENDING,
          message: `Translations are still running for ${readiness.pending.length} language(s). It can go live once they finish.`,
          ...readiness,
        });
      }

      await manager.update(Prompt, promptId, {
        currentVersion: target.version,
        provider: target.provider ?? null,
        model: target.model ?? null,
        temperature: target.temperature ?? null,
        availableVariables: reconcileAvailableVariables(
          prompt.availableVariables,
          placeholdersIn(target.prompt),
        ),
      } as Partial<Prompt>);
      if (!target.publishedAt) {
        await manager.update(PromptVersion, target.id, {
          publishedAt: new Date(),
        });
      }
      await this.pruneHistory(manager, promptId, target.version);

      this.logger.info(
        `[SKILLS_STORE] ${prompt.promptCode}: v${current ?? '-'} -> v${target.version} live` +
          (readiness.failed.length
            ? `; ${readiness.failed.length} language(s) keep English (translation failed)`
            : ''),
      );
      return {
        promptId,
        version: target.version,
        previousVersion: current,
        failedLanguages: readiness.failed,
      };
    });
  }

  /**
   * Create a version and put it live in one step, for writers that publish
   * directly (sync of a new prompt, import into a local store, revert, an
   * experiment's Apply). Translations run in the foreground first, so the
   * version and its translations go live together.
   */
  async createAndPromote(
    promptId: string,
    input: CreateVersionInput,
    options: { evalApproved?: boolean } = {},
  ): Promise<PromoteResult> {
    const created = await this.createVersion(promptId, input, {
      translate: 'none',
    });
    const current = await this.currentVersionOf(promptId);
    await this.promptTranslationService.translateBody(
      promptId,
      created.prompt,
      created.id,
    );
    return this.promote(promptId, created.version, current, options);
  }

  async listVersions(promptId: string): Promise<VersionSummary[]> {
    const prompt = await this.dataSource.manager.findOne(Prompt, {
      where: { id: promptId },
    });
    if (!prompt) throw new NotFoundException('Prompt not found');
    const versions = await this.dataSource.manager.find(PromptVersion, {
      where: { promptId },
      order: { version: 'DESC' },
    });
    const current = prompt.currentVersion ?? null;
    const summaries: VersionSummary[] = [];
    for (const v of versions) {
      const status: VersionSummary['status'] =
        v.version === current
          ? 'live'
          : v.version > (current ?? 0) && !v.publishedAt
            ? 'candidate'
            : 'history';
      summaries.push({
        version: v.version,
        status,
        prompt: v.prompt,
        provider: v.provider ?? null,
        model: v.model ?? null,
        temperature: v.temperature ?? null,
        contentHash: v.contentHash ?? hashPromptBody(v.prompt),
        source: v.source ?? null,
        note: v.note ?? null,
        evalSummary: v.evalSummary ?? null,
        createdBy: v.createdBy ?? null,
        createdAt: v.createdAt,
        publishedAt: v.publishedAt ?? null,
        ...(status !== 'history'
          ? {
              translations: await this.readinessWith(
                this.dataSource.manager,
                prompt,
                v,
              ),
            }
          : {}),
      });
    }
    return summaries;
  }

  async getReadiness(
    promptId: string,
    version: number,
  ): Promise<TranslationReadiness> {
    const manager = this.dataSource.manager;
    const prompt = await manager.findOne(Prompt, { where: { id: promptId } });
    const target = await manager.findOne(PromptVersion, {
      where: { promptId, version },
    });
    if (!prompt || !target) throw new NotFoundException('Version not found');
    return this.readinessWith(manager, prompt, target);
  }

  /** Start (or retry) translating a version's body; used by the editor's retry. */
  async translateVersion(promptId: string, version: number): Promise<void> {
    const target = await this.dataSource.manager.findOne(PromptVersion, {
      where: { promptId, version },
    });
    if (!target) throw new NotFoundException('Version not found');
    await this.promptTranslationService.translateBody(
      promptId,
      target.prompt,
      target.id,
      { retryFailed: true },
    );
  }

  async currentVersionOf(promptId: string): Promise<number | null> {
    const row = await this.dataSource.manager.findOne(Prompt, {
      where: { id: promptId },
      select: ['id', 'currentVersion'],
    });
    return row?.currentVersion ?? null;
  }

  async latestVersionOf(promptId: string): Promise<number | null> {
    return this.latestVersionNumber(this.dataSource.manager, promptId);
  }

  private async lockPrompt(
    manager: EntityManager,
    promptId: string,
  ): Promise<Prompt> {
    const prompt = await manager
      .createQueryBuilder(Prompt, 'prompt')
      .setLock('pessimistic_write')
      .where('prompt.id = :promptId', { promptId })
      .getOne();
    if (!prompt) throw new NotFoundException('Prompt not found');
    return prompt;
  }

  private async latestVersionNumber(
    manager: EntityManager,
    promptId: string,
  ): Promise<number | null> {
    const row = await manager
      .createQueryBuilder(PromptVersion, 'v')
      .select('MAX(v.version)', 'max')
      .where('v.promptId = :promptId', { promptId })
      .getRawOne<{ max: number | string | null }>();
    return row?.max == null ? null : Number(row.max);
  }

  private async readinessWith(
    manager: EntityManager,
    prompt: Prompt,
    version: PromptVersion,
  ): Promise<TranslationReadiness> {
    const translatable =
      !!prompt.translationEnabled &&
      TRANSLATABLE_PROMPT_TYPES.includes(prompt.promptType ?? '');
    const result: TranslationReadiness = {
      translatable,
      ready: [],
      failed: [],
      pending: [],
    };
    if (!translatable) return result;
    const languages =
      await this.promptTranslationService.getEligibleTargetLanguages();
    const rows = await manager.find(PromptTranslation, {
      where: {
        promptId: prompt.id,
        sourceHash: hashPromptBody(version.prompt),
      },
    });
    const byLanguage = new Map(rows.map((r) => [r.languageId, r]));
    for (const language of languages) {
      const row = byLanguage.get(language.id!);
      if (row?.status === 'ready') result.ready.push(language.id!);
      else if (row?.status === 'failed')
        result.failed.push({ languageId: language.id!, error: row.error });
      else result.pending.push(language.id!);
    }
    return result;
  }

  /**
   * Keep the live version, every candidate newer than it, and the newest
   * {@link PROMPT_VERSION_HISTORY_LIMIT} versions below it. Translations of a
   * pruned body go with it. Sessions record each version's hash, so a pruned
   * version still identifies the text that ran.
   */
  private async pruneHistory(
    manager: EntityManager,
    promptId: string,
    liveVersion: number,
  ): Promise<void> {
    const keepFrom = liveVersion - PROMPT_VERSION_HISTORY_LIMIT;
    if (keepFrom <= 1) return;
    await manager
      .createQueryBuilder()
      .delete()
      .from(PromptVersion)
      .where('promptId = :promptId', { promptId })
      .andWhere('version < :keepFrom', { keepFrom })
      .execute();
    // Hash in JS, as translations were keyed, rather than trusting SQL's trim.
    const kept = await manager.find(PromptVersion, {
      where: { promptId },
      select: ['id', 'prompt'],
    });
    const keptHashes = kept.map((v) => hashPromptBody(v.prompt));
    if (!keptHashes.length) return;
    await manager
      .createQueryBuilder()
      .delete()
      .from(PromptTranslation)
      .where('promptId = :promptId', { promptId })
      .andWhere('"sourceHash" NOT IN (:...keptHashes)', { keptHashes })
      .execute();
  }

  private translateInBackground(promptId: string, version: PromptVersion) {
    void this.promptTranslationService
      .translateBody(promptId, version.prompt, version.id)
      .catch((err: unknown) =>
        this.logger.error(
          `[SKILLS_STORE] translating v${version.version} of ${promptId} failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        ),
      );
  }
}
