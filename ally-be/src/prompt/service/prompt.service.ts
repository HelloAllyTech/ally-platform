import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, DeepPartial, In } from 'typeorm';
import { Prompt } from '../entity/prompt.entity';
import { PromptsRepository } from '../repository/prompt.repository';
import { PromptVersionRepository } from '../repository/prompt-version.repository';
import { PromptSharedService } from './prompt-shared.service';
import { UpdatePromptDto } from '../dto/update-prompt.dto';
import { CreatePromptsDto } from '../dto/create-prompts.dto';
import { SyncPromptsDto } from '../dto/sync-prompts.dto';
import { Pagination } from 'src/common/type/common.type';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { PromptResponse } from '../type/prompt-response.type';
import { standardizePromptCode } from '../util/prompt-code.util';
import { parseVariablesFromPrompt } from '../util/parse-variables.util';
import { reconcileAvailableVariables } from '../util/normalize-available-variable.util';
import { TRANSLATABLE_PROMPT_TYPES } from '../constants/prompt.constants';
import { LoggerService } from 'src/logger/logger.service';
import { PromptTranslationService } from './prompt-translation.service';
import { PromptVersioningService } from './prompt-versioning.service';
import { PromptVersionSource } from '../entity/prompt-version.entity';
import { hashPromptBody } from '../util/prompt-contract.util';

@Injectable()
export class PromptsService {
  private readonly logger = LoggerService.getInstance(PromptsService.name);

  constructor(
    private readonly promptsRepository: PromptsRepository,
    private readonly promptVersionRepository: PromptVersionRepository,
    private readonly promptSharedService: PromptSharedService,
    private readonly dataSource: DataSource,
    private readonly promptTranslationService: PromptTranslationService,
    private readonly versioning: PromptVersioningService,
  ) {}

  async createPrompts(createPromptsDto: CreatePromptsDto): Promise<Prompt[]> {
    const userId = Number(ExecutionManager.getUserId());
    const prompts = createPromptsDto.prompts.map((promptDto) =>
      this.promptsRepository.create({
        promptCode: standardizePromptCode(promptDto.promptCode),
        name: promptDto.name,
        description: promptDto.description || '',
        category: promptDto.category,
        useDashboardOverride: true,
      }),
    );

    const savedPrompts = await this.promptsRepository.save(prompts);

    // Each new prompt starts with its text as the live version 1.
    for (const savedPrompt of savedPrompts) {
      const body =
        createPromptsDto.prompts.find(
          (p) => standardizePromptCode(p.promptCode) === savedPrompt.promptCode,
        )?.prompt || '';
      if (!body.trim()) continue;
      const result = await this.versioning.createAndPromote(savedPrompt.id, {
        body,
        baseVersion: null,
        source: PromptVersionSource.DASHBOARD,
        createdBy: userId,
      });
      savedPrompt.currentVersion = result.version;
    }

    return savedPrompts;
  }

  /**
   * Update a prompt's metadata: name, description, category, studio visibility,
   * type and the translation opt-in. What the prompt does at runtime — its
   * text and model settings — changes only through a new version
   * (`createVersion`, then `promote`), so this refuses those fields when they
   * differ from the live version. A form that resends unchanged values is fine.
   */
  async updatePrompt(
    id: string,
    updatePromptDto: UpdatePromptDto,
  ): Promise<boolean> {
    const prompt = await this.promptsRepository.findOne({
      where: { id },
    });

    if (!prompt) {
      throw new NotFoundException('Prompt not found');
    }

    await this.refuseBehaviourChange(prompt, updatePromptDto);

    const updateData: DeepPartial<Prompt> = {};

    if (updatePromptDto.name) {
      updateData.name = updatePromptDto.name;
    }

    if (updatePromptDto.description !== undefined) {
      updateData.description = updatePromptDto.description;
    }

    if (updatePromptDto.category !== undefined) {
      updateData.category = updatePromptDto.category;
    }

    if (updatePromptDto.kind !== undefined) {
      updateData.kind = updatePromptDto.kind;
    }

    if (updatePromptDto.promptType !== undefined) {
      updateData.promptType = updatePromptDto.promptType;
    }

    if (updatePromptDto.hasStates !== undefined) {
      updateData.hasStates = updatePromptDto.hasStates;
    }

    // Studio-picker visibility. Purely a future-selection concern: flipping it
    // touches no version, no translation and no runtime resolution path, so
    // scenarios already pointing at this promptCode are unaffected.
    if (updatePromptDto.visibleInStudio !== undefined) {
      updateData.visibleInStudio = updatePromptDto.visibleInStudio;
    }

    if (updatePromptDto.usesBlocks !== undefined) {
      updateData.usesBlocks = updatePromptDto.usesBlocks;
    }

    if (updatePromptDto.translationEnabled !== undefined) {
      updateData.translationEnabled = updatePromptDto.translationEnabled;
    }

    const updated = Object.keys(updateData).length
      ? await this.promptsRepository.update(id, updateData)
      : { affected: 1 };

    this.maybeTriggerAutoTranslation(id, prompt, updatePromptDto, {
      versionCreated: false,
    });

    return updated.affected !== 0;
  }

  /**
   * Refuse a metadata update that would change what the prompt does: its text,
   * model settings or code. Codes are stable ids that scenarios and runtimes
   * look prompts up by.
   */
  private async refuseBehaviourChange(
    prompt: Prompt,
    dto: UpdatePromptDto,
  ): Promise<void> {
    const differs = (next: unknown, current: unknown) =>
      (next === '' ? null : (next ?? null)) !== (current ?? null);
    const changed: string[] = [];
    if (dto.promptCode && dto.promptCode !== prompt.promptCode) {
      changed.push('promptCode');
    }
    if (dto.provider !== undefined && differs(dto.provider, prompt.provider)) {
      changed.push('provider');
    }
    if (dto.model !== undefined && differs(dto.model, prompt.model)) {
      changed.push('model');
    }
    if (
      dto.temperature !== undefined &&
      differs(dto.temperature, prompt.temperature)
    ) {
      changed.push('temperature');
    }
    const next = dto.prompt?.trim();
    if (next) {
      const live = (
        await this.promptSharedService.getPromptByCode(prompt.promptCode)
      )?.trim();
      if (next !== live) changed.push('prompt');
    }
    if (changed.length) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'use_versions',
        message:
          `${changed.join(', ')} can't be changed here. ` +
          (changed.includes('promptCode')
            ? 'A prompt code is a stable id. '
            : 'Save a new version and publish it instead.'),
        fields: changed,
      });
    }
  }

  /** Save the editor's text and settings as a new candidate version. */
  async createVersion(
    id: string,
    input: {
      prompt: string;
      baseVersion: number | null;
      provider?: string | null;
      model?: string | null;
      temperature?: number | null;
      note?: string | null;
      evalSummary?: Record<string, unknown> | null;
    },
    source: PromptVersionSource = PromptVersionSource.DASHBOARD,
  ) {
    const userId = Number(ExecutionManager.getUserId()) || 0;
    const created = await this.versioning.createVersion(id, {
      body: input.prompt,
      baseVersion: input.baseVersion,
      provider: input.provider || null,
      model: input.model || null,
      temperature: input.temperature ?? null,
      note: input.note ?? null,
      evalSummary: input.evalSummary ?? null,
      source,
      createdBy: userId,
    });
    return {
      version: created.version,
      contentHash: created.contentHash,
      status: 'candidate' as const,
    };
  }

  promoteVersion(
    id: string,
    version: number,
    expectedCurrentVersion: number | null,
    options: {
      allowRollback?: boolean;
      confirmJudgeRubricChange?: boolean;
    } = {},
  ) {
    return this.versioning.promote(
      id,
      version,
      expectedCurrentVersion,
      options,
    );
  }

  translateVersion(id: string, version: number) {
    return this.versioning.translateVersion(id, version);
  }

  listVersions(id: string) {
    return this.versioning.listVersions(id);
  }

  /**
   * Fire-and-forget re-translation when a `translationEnabled` main_agent/
   * branching source changes its English body (a new version) or when
   * translation was just enabled. Runs in the background so the update response
   * isn't blocked; `translatePrompt` re-checks eligibility and skips languages
   * already fresh by `sourceHash`, so an over-eager fire is a cheap no-op.
   */
  private maybeTriggerAutoTranslation(
    id: string,
    previous: Prompt,
    dto: UpdatePromptDto,
    ctx: { versionCreated: boolean },
  ): void {
    const finalTranslationEnabled =
      dto.translationEnabled !== undefined
        ? dto.translationEnabled
        : previous.translationEnabled;
    const finalPromptType =
      dto.promptType !== undefined ? dto.promptType : previous.promptType;
    const justEnabled =
      dto.translationEnabled === true && previous.translationEnabled !== true;

    if (
      finalTranslationEnabled !== true ||
      !TRANSLATABLE_PROMPT_TYPES.includes(finalPromptType ?? '') ||
      !(ctx.versionCreated || justEnabled)
    ) {
      return;
    }

    void this.promptTranslationService
      .translatePrompt(id)
      .then((r) =>
        this.logger.info(`Auto-translation ${id}: ${JSON.stringify(r)}`),
      )
      .catch((err: unknown) =>
        this.logger.error(
          `Auto-translation trigger failed for ${id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        ),
      );
  }

  async getPrompts(
    searchName?: string,
    options?: Pagination,
  ): Promise<PromptResponse[]>;
  async getPrompts(
    searchName?: string,
    includeBlocks?: boolean,
    options?: Pagination,
  ): Promise<PromptResponse[]>;
  async getPrompts(
    searchName?: string,
    arg2?: boolean | Pagination,
    arg3?: Pagination,
  ): Promise<PromptResponse[]> {
    const includeBlocks = typeof arg2 === 'boolean' ? arg2 : true;
    const options = typeof arg2 === 'boolean' ? arg3 : arg2;

    const data = await this.promptsRepository.getPrompts(
      searchName,
      includeBlocks,
      options,
    );
    console.log(
      `getPrompts returned ${data.length} prompts. searchName: ${searchName}`,
    );
    for (const row of data) {
      if (!row.prompt?.trim() && row.defaultPrompt) {
        row.prompt = row.defaultPrompt;
      }
    }
    return data;
  }

  async getPromptsByCodes(codes: string[]): Promise<Record<string, string>> {
    const prompts = await this.promptSharedService.getPromptsByOptions({
      promptCode: codes,
    });
    return (prompts ?? []).reduce<Record<string, string>>((acc, p) => {
      acc[p.promptCode] = p.prompt ?? '';
      return acc;
    }, {});
  }

  /**
   * List variants for a given promptType (e.g. 'main_agent').
   * Used by the studio prompt picker. Excludes obsolete rows. `.prompt` is the
   * live version's text (the default text only when a row has no version).
   */
  async getPromptsByType(promptType: string): Promise<PromptResponse[]> {
    const data = await this.promptsRepository.getPromptsByType(promptType);
    for (const row of data) {
      if (!row.prompt?.trim() && row.defaultPrompt) {
        row.prompt = row.defaultPrompt;
      }
    }
    return data;
  }

  /**
   * Duplicate a prompt into a new variant row. Copies prompt text, metadata,
   * promptType, hasStates, availableVariables, usesBlocks, contract and the
   * live model settings. Generates a new promptCode (`<source>_copy_<short-id>`)
   * and name, and publishes the copied text as the variant's live version 1.
   */
  async duplicatePrompt(sourceId: string): Promise<Prompt> {
    const userId = Number(ExecutionManager.getUserId());

    const source = await this.promptsRepository.findOne({
      where: { id: sourceId },
    });
    if (!source) {
      throw new NotFoundException('Source prompt not found');
    }

    // Resolve content: prefer the current published version, fall back to
    // defaultPrompt, then to the codebase default. Without content there's
    // nothing useful to duplicate.
    let sourceContent: string | null = null;
    if (source.currentVersion != null) {
      const v = await this.promptVersionRepository.findOne({
        where: { promptId: source.id, version: source.currentVersion },
      });
      sourceContent = v?.prompt ?? null;
    }
    if (!sourceContent) {
      sourceContent =
        source.defaultPrompt ??
        (await this.promptSharedService.getPromptByCode(source.promptCode)) ??
        null;
    }
    if (!sourceContent) {
      throw new NotFoundException('Source prompt has no content to duplicate');
    }

    // Re-reconcile availableVariables against the actual content being
    // duplicated. Source's `availableVariables` could be stale (manual
    // trims via prompt management leave entries that don't match the
    // current text). Walking the text now guarantees the duplicate
    // starts with a consistent variable list.
    const sourceParsedNames = parseVariablesFromPrompt(sourceContent);
    const reconciledAvailableVariables = reconcileAvailableVariables(
      source.availableVariables,
      sourceParsedNames,
    );

    const newName = `${source.name} (copy)`;
    // Rule: every main-agent variant except the file-backed default carries
    // states. Duplicates (which only exist in DB and never sync from file)
    // are by definition not the default, so we force hasStates=true here
    // regardless of the source row's flag. The studio no longer surfaces a
    // Has-States toggle in prompt management; this is the single place that
    // decides the new variant's value.
    const newHasStates =
      source.promptType === 'main_agent' ? true : source.hasStates;

    // Retry the insert on `promptCode` unique-constraint collision. ShortId
    // uses ms-timestamp + 4-digit base36 randomness; collision is rare but
    // possible when two admins duplicate the same source within the same
    // millisecond and roll the same random suffix. A single retry with a
    // fresh shortId is overwhelmingly likely to succeed.
    const MAX_DUPLICATE_RETRIES = 3;
    let saved: Prompt | null = null;
    for (let attempt = 0; attempt < MAX_DUPLICATE_RETRIES; attempt++) {
      const shortId =
        Date.now().toString(36) +
        Math.floor(Math.random() * 1e4)
          .toString(36)
          .padStart(3, '0');
      const newPromptCode = standardizePromptCode(
        `${source.promptCode}_copy_${shortId}`,
      );
      const created = this.promptsRepository.create({
        promptCode: newPromptCode,
        name: newName,
        description: source.description,
        category: source.category,
        defaultPrompt: source.defaultPrompt,
        useDashboardOverride: true,
        isObsolete: false,
        // A new variant is offered in the studio picker immediately. Hiding is
        // an explicit, deliberate act — never the starting state — so an admin
        // duplicating a prompt doesn't have to go find a switch to make their
        // new variant selectable.
        visibleInStudio: true,
        kind: source.kind,
        promptType: source.promptType,
        hasStates: newHasStates,
        availableVariables: reconciledAvailableVariables,
        usesBlocks: source.usesBlocks,
        contract: source.contract ?? null,
        provider: source.provider,
        model: source.model,
        temperature: source.temperature,
      });
      try {
        saved = await this.promptsRepository.save(created);
        break;
      } catch (err: unknown) {
        const driverError =
          (err as { code?: string; driverError?: { code?: string } })
            ?.driverError ?? (err as { code?: string });
        const isUniqueViolation =
          driverError?.code === '23505'; /* Postgres unique_violation */
        if (!isUniqueViolation || attempt === MAX_DUPLICATE_RETRIES - 1) {
          throw err;
        }
        this.logger.warn(
          `[PROMPT_DUPLICATE] retry attempt=${attempt + 1}/${MAX_DUPLICATE_RETRIES} ` +
            `sourceId=${sourceId} reason=unique_violation_promptCode`,
        );
        // Brief stagger so the next Date.now() is at least 1ms ahead.
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
    }
    if (!saved) {
      throw new Error('duplicatePrompt: failed to save after retries');
    }

    const version = this.promptVersionRepository.create({
      promptId: saved.id,
      version: 1,
      prompt: sourceContent,
      createdBy: userId,
      updatedBy: userId,
      provider: source.provider ?? null,
      model: source.model ?? null,
      temperature: source.temperature ?? null,
      contentHash: hashPromptBody(sourceContent),
      source: PromptVersionSource.DUPLICATE,
      note: `Duplicated from ${source.promptCode}.`,
      publishedAt: new Date(),
    });
    await this.promptVersionRepository.save(version);
    await this.promptsRepository.update(saved.id, { currentVersion: 1 });

    saved.currentVersion = 1;
    // Attach the just-created version body to the response so the
    // studio side panel can render the new variant's editor with the
    // source's text pre-filled. Without this, FE consumers that read
    // `prompt.prompt` (the live editable body — a virtual field stitched
    // from prompts_versions at currentVersion in getPrompts queries)
    // see undefined and render the placeholder "Enter prompt text",
    // which looks like a duplicate of empty content rather than a copy
    // of the source.
    (saved as Prompt & { prompt: string }).prompt = sourceContent;
    return saved;
  }

  /**
   * Sync prompts from the Git defaults to the store.
   *
   * - A prompt the store doesn't have yet is created, with its default text
   *   live as version 1. That is how a new prompt reaches production.
   * - An existing prompt's live text is never touched. Sync refreshes only what
   *   Git owns: the default text (fallback and Revert baseline), file metadata
   *   and the code's contract.
   * - One bad item (say, a dashboard rename that took its name) is logged and
   *   skipped instead of aborting the rest of the sync.
   *
   * Prompts missing from the sync are marked obsolete (grouped by ally_ai_learn
   * vs native ally-be). That only labels them in the Skills Store; a live prompt
   * keeps serving, so deleting a default never disables it.
   */
  async syncPrompts(syncPromptsDto: SyncPromptsDto): Promise<{
    added: number;
    updated: number;
  }> {
    let added = 0;
    let updated = 0;

    const incomingCodes = syncPromptsDto.prompts.map((p) =>
      standardizePromptCode(p.promptCode),
    );
    const isFromAllyAiLearn = incomingCodes.some((code) =>
      code.startsWith('ally_ai_learn_'),
    );

    for (const item of syncPromptsDto.prompts) {
      const promptCode = standardizePromptCode(item.promptCode);
      try {
        const result = await this.syncOne(promptCode, item);
        if (result === 'added') added++;
        else updated++;
      } catch (err) {
        this.logger.error(
          `[PROMPT_SYNC] skipped promptCode=${promptCode}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    // Pass 2: Mark missing prompts as obsolete (scoped to the sync source)
    const query = this.promptsRepository.createQueryBuilder('prompt');

    const isFromAllyAi = incomingCodes.some(
      (code) =>
        code.startsWith('ally_ai_') && !code.startsWith('ally_ai_learn_'),
    );
    const isInternalBE = incomingCodes.some((code) =>
      code.startsWith('openai_'),
    );

    if (isFromAllyAiLearn) {
      query.where('prompt.promptCode LIKE :prefix', {
        prefix: 'ally_ai_learn_%',
      });
    } else if (isFromAllyAi) {
      query
        .where('prompt.promptCode LIKE :prefix', { prefix: 'ally_ai_%' })
        .andWhere('prompt.promptCode NOT LIKE :learnPrefix', {
          learnPrefix: 'ally_ai_learn_%',
        });
    } else if (isInternalBE) {
      query.where('prompt.promptCode LIKE :prefix', { prefix: 'openai_%' });
    } else {
      // If we don't recognize the prefix pattern, skip auto-obsolescence
      // to avoid accidentally nuking prompts from other services.
      return { added, updated };
    }

    if (incomingCodes.length > 0) {
      query.andWhere('prompt.promptCode NOT IN (:...incomingCodes)', {
        incomingCodes,
      });
    }
    // Exclude "Duplicate as variant" rows from auto-obsolescence. These
    // live entirely in the DB — there's no `.txt` file to back them, so
    // they NEVER appear in incomingCodes and would otherwise get marked
    // obsolete on every container restart. Convention: duplicatePrompt
    // sets the new promptCode to `<source>_copy_<shortId>`. The LIKE
    // pattern below matches that suffix and protects all such rows.
    query.andWhere('prompt.promptCode NOT LIKE :copySuffix', {
      copySuffix: '%\\_copy\\_%',
    });
    query.andWhere('prompt.isObsolete = :isObsolete', { isObsolete: false });

    const obsoletePrompts = await query.getMany();
    if (obsoletePrompts.length > 0) {
      await this.promptsRepository.update(
        { id: In(obsoletePrompts.map((p) => p.id)) },
        { isObsolete: true },
      );
    }

    return { added, updated };
  }

  private async syncOne(
    promptCode: string,
    item: SyncPromptsDto['prompts'][number],
  ): Promise<'added' | 'updated'> {
    const existing = await this.promptsRepository.findOne({
      where: { promptCode },
    });
    // Demoted to debug — fires once per prompt on every container boot.
    this.logger.debug(
      `[PROMPT_SYNC] processing promptCode=${promptCode} bodyChars=${item.prompt?.length ?? 0}`,
    );
    if (!existing) {
      const prompt = this.promptsRepository.create({
        promptCode,
        name: item.name,
        description: item.description || '',
        category: item.category,
        defaultPrompt: item.prompt,
        useDashboardOverride: true,
        kind: item.kind,
        promptType: item.promptType,
        hasStates: item.hasStates,
        availableVariables: item.availableVariables,
        usesBlocks: item.usesBlocks,
        runtimes: item.runtimes,
        contract: item.contract ?? null,
        // A sidecar's default model applies to the new row only: once the row
        // exists, model settings belong to its versions.
        ...(item.defaultModel
          ? { provider: item.defaultProvider, model: item.defaultModel }
          : {}),
        isObsolete: false,
      });
      const saved = await this.promptsRepository.save(prompt);

      const version = this.promptVersionRepository.create({
        promptId: saved.id,
        version: 1,
        prompt: item.prompt,
        createdBy: 0,
        updatedBy: 0,
        provider: item.defaultModel ? (item.defaultProvider ?? null) : null,
        model: item.defaultModel ?? null,
        contentHash: hashPromptBody(item.prompt),
        source: PromptVersionSource.SYNC,
        note: 'Created from the default in Git.',
        publishedAt: new Date(),
      });
      await this.promptVersionRepository.save(version);
      await this.promptsRepository.update(saved.id, { currentVersion: 1 });
      return 'added';
    }

    // Git owns the default text, the file metadata and the contract. The live
    // version, model settings and studio visibility belong to the store.
    //
    // `availableVariables` carries the studio's labels and required flags, and
    // is reconciled against the live text on every promotion; sync only seeds
    // it for a row that has none.
    // `name` is left alone too: a rename in the Skills Store is an admin's
    // choice, and overwriting it could collide with another row's name.
    const updatePayload: Partial<Prompt> = {
      defaultPrompt: item.prompt,
      description: item.description || '',
      category: item.category,
      kind: item.kind,
      usesBlocks: item.usesBlocks,
      runtimes: item.runtimes,
      isObsolete: false, // resurrected if it was obsolete
    };
    if (item.contract !== undefined) {
      updatePayload.contract = item.contract ?? null;
    }
    const existingVarsCount = Array.isArray(existing.availableVariables)
      ? existing.availableVariables.length
      : 0;
    if (existingVarsCount === 0) {
      updatePayload.availableVariables = item.availableVariables;
    }
    if (item.promptType !== undefined) {
      updatePayload.promptType = item.promptType;
    }
    if (item.hasStates !== undefined) {
      updatePayload.hasStates = item.hasStates;
    }
    await this.promptsRepository.update(existing.id, updatePayload);
    return 'updated';
  }

  async deleteObsoletePrompt(id: string): Promise<void> {
    const prompt = await this.promptsRepository.findOne({ where: { id } });
    if (!prompt) {
      throw new NotFoundException('Prompt not found');
    }
    // Two delete paths:
    //   1) File-backed prompts: only deletable when isObsolete=true.
    //      A non-obsolete file-backed prompt would just resurrect on the
    //      next syncPrompts run anyway, so allowing deletion would be
    //      misleading UX. Admins must first remove the .txt file in code
    //      (which makes syncPrompts auto-obsolete the row) before
    //      deleting through this endpoint.
    //   2) Dashboard duplicates ("Duplicate as variant" rows with a
    //      `*_copy_<shortId>` promptCode suffix): freely deletable
    //      regardless of isObsolete. These live entirely in the DB —
    //      there's no file to resurrect them and no other admin tooling
    //      to clean them up, so the studio's delete button is the only
    //      way to remove them.
    const isDuplicate = prompt.promptCode.includes('_copy_');
    if (!prompt.isObsolete && !isDuplicate) {
      throw new BadRequestException(
        'Only obsolete prompts or duplicated variants can be deleted. ' +
          'File-backed prompts must be removed from code and resynced first.',
      );
    }
    // Refuse delete when the variant is still referenced by any scenario.
    // Forces the admin to switch those scenarios off this variant before
    // removing it, avoiding silent fallback to the default prompt on the
    // next session run.
    const usage = await this.countScenarioUsage(
      prompt.promptCode,
      prompt.promptType,
    );
    if (usage > 0) {
      throw new ConflictException(
        `Cannot delete: variant is used by ${usage} simulation` +
          `${usage === 1 ? '' : 's'}. Switch ${usage === 1 ? 'it' : 'them'} ` +
          'to another prompt first.',
      );
    }
    await this.promptVersionRepository.delete({ promptId: id });
    await this.promptsRepository.delete(id);
  }

  /**
   * Which `scenarios.metadata` key holds a reference to a prompt of this type.
   * `main_agent` variants are selected via the studio's Skill Version picker,
   * `transcript_evaluator` variants via the report page's evaluator picker —
   * two different jsonb keys, so a type-blind count would report zero usage
   * for every evaluator variant and wrongly present it as unused.
   */
  private scenarioMetadataKeyFor(promptType?: string | null): string {
    return promptType === 'transcript_evaluator'
      ? 'selectedEvaluatorPromptCode'
      : 'selectedMainPromptCode';
  }

  /**
   * Count active scenarios referencing the given promptCode through the
   * metadata key that matches its promptType. Used to gate deletion of
   * duplicated variants and to surface usage info in the studio side panel
   * (both the delete tooltip and the "Show in Studio" warning).
   *
   * The reference lives inside scenarios.metadata (jsonb), not as its own
   * column — the query reads it via the ->> operator. Soft-deleted scenarios
   * (deletedAt IS NOT NULL) are excluded since they can't be reactivated
   * through the dashboard.
   */
  private async countScenarioUsage(
    promptCode: string,
    promptType?: string | null,
  ): Promise<number> {
    const rows: Array<{ count: string }> = await this.dataSource.query(
      `SELECT COUNT(*)::text AS count
         FROM scenarios
        WHERE metadata->>($2::text) = $1
          AND "deletedAt" IS NULL`,
      [promptCode, this.scenarioMetadataKeyFor(promptType)],
    );
    return Number(rows[0]?.count ?? 0);
  }

  /**
   * Returns the in-use count + a small sample of referencing scenarios so
   * the studio can show "Used by N simulations" diagnostics next to the
   * Delete button and under the "Show in Studio" switch. Capped at 10 to keep
   * the payload bounded.
   */
  async getPromptUsage(id: string): Promise<{
    count: number;
    scenarios: Array<{ id: number; title: string }>;
  }> {
    const prompt = await this.promptsRepository.findOne({ where: { id } });
    if (!prompt) {
      throw new NotFoundException('Prompt not found');
    }
    const count = await this.countScenarioUsage(
      prompt.promptCode,
      prompt.promptType,
    );
    if (count === 0) return { count: 0, scenarios: [] };
    const scenarios: Array<{ id: number; title: string }> =
      await this.dataSource.query(
        `SELECT id, title
           FROM scenarios
          WHERE metadata->>($2::text) = $1
            AND "deletedAt" IS NULL
          ORDER BY id DESC
          LIMIT 10`,
        [prompt.promptCode, this.scenarioMetadataKeyFor(prompt.promptType)],
      );
    return { count, scenarios };
  }

  /** A prompt's id from its code, or null. */
  async findIdByCode(promptCode: string): Promise<string | null> {
    const prompt = await this.promptsRepository.findOne({
      where: { promptCode },
      select: { id: true },
    });
    return prompt?.id ?? null;
  }

  /**
   * Revert a prompt to its default text from Git: a new version carrying the
   * default, put live with the live model settings, translations included.
   * Goes through the same write path as every other change.
   */
  async revertPrompt(id: string): Promise<boolean> {
    const prompt = await this.promptsRepository.findOne({ where: { id } });
    if (!prompt) {
      throw new NotFoundException('Prompt not found');
    }
    if (!prompt.defaultPrompt?.trim()) {
      throw new NotFoundException(
        'Cannot revert: this prompt has no default text in Git',
      );
    }
    await this.versioning.createAndPromote(id, {
      body: prompt.defaultPrompt,
      baseVersion: await this.versioning.latestVersionOf(id),
      provider: prompt.provider ?? null,
      model: prompt.model ?? null,
      temperature: prompt.temperature ?? null,
      source: PromptVersionSource.REVERT,
      note: 'Reverted to the default text in Git.',
      createdBy: Number(ExecutionManager.getUserId()) || 0,
    });
    return true;
  }
}
