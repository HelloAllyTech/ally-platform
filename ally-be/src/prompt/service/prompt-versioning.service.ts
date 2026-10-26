import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DataSource, EntityManager, In, IsNull } from 'typeorm';
import { Prompt } from '../entity/prompt.entity';
import {
  PromptVersion,
  PromptVersionSource,
} from '../entity/prompt-version.entity';
import { PromptTranslation } from '../entity/prompt-translation.entity';
import { PromptTranslationService } from './prompt-translation.service';
import { PromptSharedService } from './prompt-shared.service';
import { TRANSLATABLE_PROMPT_TYPES } from '../constants/prompt.constants';
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
import { ErrorCode } from 'src/exception/error-code.enum';
import {
  PINNED_PROMPTS,
  PINNED_PROMPT_REFUSAL,
} from '../constants/pinned-prompts.constants';

/** Error codes a writer can branch on: the response's `errorCode`, with `details`. */
export const SKILLS_STORE_ERROR = {
  STALE_BASE: ErrorCode.SKILLS_STORE_STALE_BASE,
  CONTRACT_VIOLATION: ErrorCode.SKILLS_STORE_CONTRACT_VIOLATION,
  TRANSLATIONS_PENDING: ErrorCode.SKILLS_STORE_TRANSLATIONS_PENDING,
  PROMPT_PINNED: ErrorCode.SKILLS_STORE_PROMPT_PINNED,
  NOT_A_CANDIDATE: ErrorCode.SKILLS_STORE_NOT_A_CANDIDATE,
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
    private readonly promptShared: PromptSharedService,
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
          errorCode: SKILLS_STORE_ERROR.STALE_BASE,
          message:
            `This prompt has changed since version ${input.baseVersion ?? 'none'}: ` +
            `the newest version is now ${latest ?? 'none'}. Pull it, merge your change, and try again.`,
          details: {
            latestVersion: latest,
            currentVersion: prompt.currentVersion ?? null,
          },
        });
      }

      const violation = checkContract(body, prompt.contract);
      if (violation) {
        throw new UnprocessableEntityException({
          statusCode: 422,
          errorCode: SKILLS_STORE_ERROR.CONTRACT_VIOLATION,
          message: `This text breaks the prompt's contract: ${describeViolation(violation)}.`,
          details: violation,
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
      /** Confirms a pinned prompt's change (see pinned-prompts.constants). */
      confirmPinnedChange?: boolean;
    } = {},
  ): Promise<PromoteResult> {
    const result = await this.dataSource.transaction(async (manager) => {
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
          errorCode: SKILLS_STORE_ERROR.STALE_BASE,
          message: `The live version changed to ${current ?? 'none'} while you were looking at ${expectedCurrentVersion ?? 'none'}. Refresh and try again.`,
          details: {
            latestVersion: await this.latestVersionNumber(manager, promptId),
            currentVersion: current,
          },
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
          errorCode: SKILLS_STORE_ERROR.NOT_A_CANDIDATE,
          message: `Version ${version} was live before. Roll back explicitly to serve it again.`,
        });
      }

      // A pinned prompt's first live version has nothing to be compared with.
      if (current !== null) {
        this.assertPinnedChangeConfirmed(
          prompt.promptCode,
          options.confirmPinnedChange,
        );
      }

      const readiness = await this.readinessWith(manager, prompt, target);
      if (
        options.requireTranslations !== false &&
        readiness.translatable &&
        readiness.pending.length
      ) {
        throw new ConflictException({
          statusCode: 409,
          errorCode: SKILLS_STORE_ERROR.TRANSLATIONS_PENDING,
          message: `Translations are still running for ${readiness.pending.length} language(s). It can go live once they finish.`,
          details: readiness,
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
    // This process serves the new version at once; others within the cache TTL.
    this.promptShared.invalidate();
    return result;
  }

  /**
   * Create a version and put it live in one step, for writers that publish
   * directly (sync of a new prompt, import into a local store, revert, an
   * experiment's Apply). Translations run in the foreground first, so the
   * version and its translations go live together.
   *
   * All or nothing: when the promote is refused, the version created for it is
   * removed again, so a refused publish never leaves a stray draft behind.
   */
  async createAndPromote(
    promptId: string,
    input: CreateVersionInput,
    options: {
      evalApproved?: boolean;
      confirmPinnedChange?: boolean;
    } = {},
  ): Promise<PromoteResult> {
    // Refuse up front what promote would refuse whatever the text says.
    const prompt = await this.dataSource.manager.findOne(Prompt, {
      where: { id: promptId },
      select: ['id', 'promptCode', 'currentVersion'],
    });
    if (!prompt) throw new NotFoundException('Prompt not found');
    if (prompt.currentVersion != null) {
      this.assertPinnedChangeConfirmed(
        prompt.promptCode,
        options.confirmPinnedChange,
      );
    }

    const created = await this.createVersion(promptId, input, {
      translate: 'none',
    });
    try {
      await this.promptTranslationService.translateBody(
        promptId,
        created.prompt,
        created.id,
      );
      return await this.promote(
        promptId,
        created.version,
        prompt.currentVersion ?? null,
        options,
      );
    } catch (err) {
      await this.discardDraft(created);
      throw err;
    }
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
    const isHistory = (v: PromptVersion) =>
      v.version !== current && !!v.publishedAt;
    const readiness = await this.readinessFor(
      this.dataSource.manager,
      prompt,
      versions.filter((v) => !isHistory(v)).map((v) => v.prompt),
    );
    const summaries: VersionSummary[] = [];
    for (const v of versions) {
      // A version that was never live is a draft wherever it sits — one saved
      // before a newer draft was published is still unpublished, not history.
      const status: VersionSummary['status'] =
        v.version === current
          ? 'live'
          : !v.publishedAt
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
          ? { translations: readiness.get(hashPromptBody(v.prompt))! }
          : {}),
      });
    }
    return summaries;
  }

  /** One version's text, or null when the prompt has no such version. */
  async getVersionBody(
    promptId: string,
    version: number,
  ): Promise<string | null> {
    if (!Number.isInteger(version)) return null;
    const row = await this.dataSource.manager.findOne(PromptVersion, {
      where: { promptId, version },
      select: ['id', 'prompt'],
    });
    return row?.prompt ?? null;
  }

  /**
   * Translate every draft (any version never published), in the background.
   * For when translation is switched on: drafts saved while it was off would
   * otherwise wait on translations nothing is running.
   */
  async translateDrafts(promptId: string): Promise<void> {
    const drafts = await this.dataSource.manager.find(PromptVersion, {
      where: { promptId, publishedAt: IsNull() },
      order: { version: 'ASC' },
    });
    for (const draft of drafts) this.translateInBackground(promptId, draft);
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
  /**
   * Discard a draft: a version that was never published. One that has been
   * live is history and stays (roll back to it instead). Its translations go
   * with it, unless another version has the same text.
   */
  async discardVersion(
    promptId: string,
    version: number,
  ): Promise<{ promptId: string; version: number }> {
    const promptCode = await this.dataSource.transaction(async (manager) => {
      const prompt = await this.lockPrompt(manager, promptId);
      const target = await manager.findOne(PromptVersion, {
        where: { promptId, version },
      });
      if (!target) {
        throw new NotFoundException(`Version ${version} not found.`);
      }
      if (target.publishedAt || prompt.currentVersion === version) {
        throw new ConflictException({
          statusCode: 409,
          errorCode: SKILLS_STORE_ERROR.NOT_A_CANDIDATE,
          message: `Version ${version} has been live, so it stays in the history. Only a draft can be discarded.`,
        });
      }
      await manager.delete(PromptVersion, { id: target.id });
      const hash = hashPromptBody(target.prompt);
      const remaining = await manager.find(PromptVersion, {
        where: { promptId },
        select: ['id', 'prompt'],
      });
      if (!remaining.some((v) => hashPromptBody(v.prompt) === hash)) {
        await manager.delete(PromptTranslation, { promptId, sourceHash: hash });
      }
      return prompt.promptCode;
    });
    this.logger.info(
      `[SKILLS_STORE] ${promptCode}: draft v${version} discarded`,
    );
    return { promptId, version };
  }

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
    const byHash = await this.readinessFor(manager, prompt, [version.prompt]);
    return byHash.get(hashPromptBody(version.prompt))!;
  }

  /**
   * Readiness of several bodies of one prompt, keyed by body hash: one
   * languages lookup and one translations query however many bodies.
   */
  private async readinessFor(
    manager: EntityManager,
    prompt: Prompt,
    bodies: string[],
  ): Promise<Map<string, TranslationReadiness>> {
    const translatable =
      !!prompt.translationEnabled &&
      TRANSLATABLE_PROMPT_TYPES.includes(prompt.promptType ?? '');
    const hashes = [...new Set(bodies.map((b) => hashPromptBody(b)))];
    const out = new Map<string, TranslationReadiness>(
      hashes.map((h) => [
        h,
        { translatable, ready: [], failed: [], pending: [] },
      ]),
    );
    if (!translatable || !hashes.length) return out;
    const [languages, rows] = await Promise.all([
      this.promptTranslationService.getEligibleTargetLanguages(),
      manager.find(PromptTranslation, {
        where: { promptId: prompt.id, sourceHash: In(hashes) },
      }),
    ]);
    const byKey = new Map(
      rows.map((r) => [`${r.sourceHash}:${r.languageId}`, r]),
    );
    for (const [hash, result] of out) {
      for (const language of languages) {
        const row = byKey.get(`${hash}:${language.id}`);
        if (row?.status === 'ready') result.ready.push(language.id!);
        else if (row?.status === 'failed')
          result.failed.push({ languageId: language.id!, error: row.error });
        else result.pending.push(language.id!);
      }
    }
    return out;
  }

  private assertPinnedChangeConfirmed(
    promptCode: string,
    confirmed: boolean | undefined,
  ): void {
    const reason = PINNED_PROMPTS.get(promptCode);
    if (!reason || confirmed) return;
    throw new ConflictException({
      statusCode: 409,
      errorCode: SKILLS_STORE_ERROR.PROMPT_PINNED,
      message: `${promptCode} ${PINNED_PROMPT_REFUSAL[reason]}`,
      details: { reason },
    });
  }

  /**
   * Remove a version `createAndPromote` made when its promote was refused.
   * Only while it is still the newest, unpublished version: once anyone has
   * built on it, it stays.
   */
  private async discardDraft(version: PromptVersion): Promise<void> {
    try {
      await this.dataSource.transaction(async (manager) => {
        const prompt = await this.lockPrompt(manager, version.promptId);
        const latest = await this.latestVersionNumber(
          manager,
          version.promptId,
        );
        if (
          latest !== version.version ||
          prompt.currentVersion === version.version
        ) {
          return;
        }
        await manager.delete(PromptVersion, {
          id: version.id,
          publishedAt: IsNull(),
        });
      });
    } catch (err) {
      this.logger.error(
        `[SKILLS_STORE] could not remove refused v${version.version} of ${version.promptId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
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
