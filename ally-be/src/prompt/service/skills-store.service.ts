import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { Prompt, PromptContract } from '../entity/prompt.entity';
import {
  PromptVersion,
  PromptVersionSource,
} from '../entity/prompt-version.entity';
import {
  PromptTranslation,
  PromptTranslationStatus,
} from '../entity/prompt-translation.entity';
import { SkillsStoreKey } from '../entity/skills-store-key.entity';
import { PromptVersioningService } from './prompt-versioning.service';
import { hashPromptBody } from '../util/prompt-contract.util';
import { LoggerService } from 'src/logger/logger.service';

export interface ExportedVersion {
  version: number;
  prompt: string;
  contentHash: string;
  provider: string | null;
  model: string | null;
  temperature: number | null;
  source: string | null;
  note: string | null;
  createdAt: Date;
}

export interface ExportedTranslation {
  languageId: number;
  sourceHash: string;
  translatedPrompt: string;
  runtimeProvider: string | null;
  runtimeModel: string | null;
}

export interface ExportedPrompt {
  promptCode: string;
  name: string;
  description: string;
  category: string | null;
  promptType: string | null;
  kind: string | null;
  hasStates: boolean;
  translationEnabled: boolean;
  availableVariables: unknown;
  contract: PromptContract | null;
  /** Newest version number, candidates included: the base for the next push. */
  latestVersion: number | null;
  live: ExportedVersion | null;
  /**
   * The newest version (a draft when one exists, else the live one): the text
   * the next push builds on, so an edit never silently drops a draft.
   */
  latest: ExportedVersion | null;
  candidates: ExportedVersion[];
  /** Ready translations of the live body and of every candidate body. */
  translations: ExportedTranslation[];
}

export interface SkillsStoreExport {
  exportedAt: string;
  prompts: ExportedPrompt[];
}

export interface ImportResult {
  updated: string[];
  unchanged: string[];
  created: string[];
  candidates: number;
  /** Prompts that could not be imported; the rest were imported regardless. */
  failed: Array<{ promptCode: string; error: string }>;
}

/**
 * The Skills Store's API for the `prompts` CLI: export (pull), push of
 * candidate versions, and import of an export into a LOCAL store, so a local
 * stack serves exactly what production serves.
 */
@Injectable()
export class SkillsStoreService {
  private readonly logger = LoggerService.getInstance(SkillsStoreService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly versioning: PromptVersioningService,
  ) {}

  async export(options: {
    codes?: string[];
    includeCandidates?: boolean;
  }): Promise<SkillsStoreExport> {
    const manager = this.dataSource.manager;
    const prompts = await manager.find(Prompt, {
      where: options.codes?.length ? { promptCode: In(options.codes) } : {},
      order: { promptCode: 'ASC' },
    });
    const ids = prompts.map((p) => p.id);
    const versions = ids.length
      ? await manager.find(PromptVersion, {
          where: { promptId: In(ids) },
          order: { version: 'ASC' },
        })
      : [];
    const translations = ids.length
      ? await manager.find(PromptTranslation, {
          where: { promptId: In(ids), status: PromptTranslationStatus.READY },
        })
      : [];

    const toExported = (v: PromptVersion): ExportedVersion => ({
      version: v.version,
      prompt: v.prompt,
      contentHash: hashPromptBody(v.prompt),
      provider: v.provider ?? null,
      model: v.model ?? null,
      temperature: v.temperature ?? null,
      source: v.source ?? null,
      note: v.note ?? null,
      createdAt: v.createdAt,
    });

    return {
      exportedAt: new Date().toISOString(),
      prompts: prompts.map((p) => {
        const mine = versions.filter((v) => v.promptId === p.id);
        const liveRow = mine.find((v) => v.version === p.currentVersion);
        const live: ExportedVersion | null = liveRow
          ? toExported(liveRow)
          : p.defaultPrompt?.trim()
            ? {
                version: 0,
                prompt: p.defaultPrompt,
                contentHash: hashPromptBody(p.defaultPrompt),
                provider: p.provider ?? null,
                model: p.model ?? null,
                temperature: p.temperature ?? null,
                source: 'default',
                note: 'No live version; the default text from Git is served.',
                createdAt: p.updatedAt,
              }
            : null;
        const candidates = options.includeCandidates
          ? mine
              .filter(
                (v) => v.version > (p.currentVersion ?? 0) && !v.publishedAt,
              )
              .map(toExported)
          : [];
        const newest = mine.length ? mine[mine.length - 1] : null;
        const latest =
          newest && newest.version !== liveRow?.version
            ? toExported(newest)
            : live;
        const hashes = new Set(
          [live, latest, ...candidates]
            .filter(Boolean)
            .map((v) => v!.contentHash),
        );
        return {
          promptCode: p.promptCode,
          name: p.name,
          description: p.description,
          category: p.category ?? null,
          promptType: p.promptType ?? null,
          kind: p.kind ?? null,
          hasStates: !!p.hasStates,
          translationEnabled: !!p.translationEnabled,
          availableVariables: p.availableVariables ?? null,
          contract: p.contract ?? null,
          latestVersion: mine.length ? mine[mine.length - 1].version : null,
          live,
          latest,
          candidates,
          translations: translations
            .filter(
              (t) =>
                t.promptId === p.id &&
                hashes.has(t.sourceHash) &&
                t.translatedPrompt?.trim(),
            )
            .map((t) => ({
              languageId: t.languageId,
              sourceHash: t.sourceHash,
              translatedPrompt: t.translatedPrompt!,
              runtimeProvider: t.runtimeProvider ?? null,
              runtimeModel: t.runtimeModel ?? null,
            })),
        };
      }),
    };
  }

  /** Push from the CLI: a new candidate version. Never goes live by itself. */
  async pushVersion(
    promptCode: string,
    input: {
      prompt: string;
      baseVersion: number | null;
      provider?: string | null;
      model?: string | null;
      temperature?: number | null;
      note?: string | null;
      evalSummary?: Record<string, unknown> | null;
    },
    key: SkillsStoreKey,
  ) {
    const prompt = await this.requirePrompt(promptCode);
    const created = await this.versioning.createVersion(prompt.id, {
      body: input.prompt,
      baseVersion: input.baseVersion,
      provider: input.provider ?? null,
      model: input.model ?? null,
      temperature: input.temperature ?? null,
      note: [`Pushed with key "${key.name}"`, input.note]
        .filter(Boolean)
        .join(': '),
      evalSummary: input.evalSummary ?? null,
      source: PromptVersionSource.CLI,
      createdBy: key.createdBy ?? 0,
    });
    return {
      promptCode,
      version: created.version,
      contentHash: created.contentHash,
      status: 'candidate' as const,
    };
  }

  async getPrompt(promptCode: string) {
    const prompt = await this.requirePrompt(promptCode);
    return {
      promptCode,
      currentVersion: prompt.currentVersion ?? null,
      latestVersion: await this.versioning.latestVersionOf(prompt.id),
      versions: await this.versioning.listVersions(prompt.id),
    };
  }

  /**
   * Load an export (from production, usually) into THIS store and serve it.
   * Refused unless SKILLS_STORE_IMPORT_ENABLED=true, which only local stacks
   * set — production must never be overwritten by an import.
   *
   * For each prompt whose live text differs, the exported live text becomes a
   * new local version, with its exported translations, and goes live.
   * Candidates are imported as local candidates.
   */
  async import(payload: SkillsStoreExport): Promise<ImportResult> {
    if (process.env.SKILLS_STORE_IMPORT_ENABLED !== 'true') {
      throw new ForbiddenException(
        'Import is disabled here. It is only for local stacks (SKILLS_STORE_IMPORT_ENABLED=true).',
      );
    }
    const result: ImportResult = {
      updated: [],
      unchanged: [],
      created: [],
      candidates: 0,
      failed: [],
    };
    // One prompt at a time, and one refusal (a contract the local code
    // changed, a stale base) skips only that prompt: the rest still import,
    // and the result names what didn't.
    for (const item of payload.prompts ?? []) {
      if (!item.live?.prompt?.trim()) continue;
      try {
        await this.importOne(item, payload.exportedAt, result);
      } catch (err) {
        // Its prompt row may exist by now, but it isn't served: say failed only.
        result.created = result.created.filter((c) => c !== item.promptCode);
        result.failed.push({
          promptCode: item.promptCode,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    this.logger.info(
      `[SKILLS_STORE] import: ${result.updated.length} updated, ${result.created.length} created, ` +
        `${result.unchanged.length} unchanged, ${result.candidates} candidates` +
        (result.failed.length ? `, ${result.failed.length} failed` : ''),
    );
    return result;
  }

  private async importOne(
    item: ExportedPrompt,
    exportedAt: string,
    result: ImportResult,
  ): Promise<void> {
    const live = item.live;
    if (!live) return;
    let prompt = await this.dataSource.manager.findOne(Prompt, {
      where: { promptCode: item.promptCode },
    });
    if (!prompt) {
      prompt = await this.dataSource.manager.save(
        Prompt,
        this.dataSource.manager.create(Prompt, {
          promptCode: item.promptCode,
          name: await this.freeName(item.name),
          description: item.description ?? '',
          category: item.category ?? undefined,
          promptType: item.promptType ?? undefined,
          kind: item.kind ?? undefined,
          hasStates: item.hasStates,
          translationEnabled: item.translationEnabled,
          contract: item.contract,
          useDashboardOverride: true,
        }),
      );
      result.created.push(item.promptCode);
    } else {
      await this.dataSource.manager.update(Prompt, prompt.id, {
        translationEnabled: item.translationEnabled,
        ...(item.contract ? { contract: item.contract } : {}),
      });
      prompt.translationEnabled = item.translationEnabled;
    }

    await this.writeTranslations(prompt.id, item.translations);

    const localLive = await this.dataSource.manager.findOne(PromptVersion, {
      where: { promptId: prompt.id, version: prompt.currentVersion ?? -1 },
    });
    if (
      localLive &&
      hashPromptBody(localLive.prompt) === live.contentHash &&
      (localLive.model ?? null) === (live.model ?? null)
    ) {
      result.unchanged.push(item.promptCode);
    } else {
      const created = await this.versioning.createVersion(
        prompt.id,
        {
          body: live.prompt,
          baseVersion: await this.versioning.latestVersionOf(prompt.id),
          provider: live.provider,
          model: live.model,
          temperature: live.temperature,
          source: PromptVersionSource.IMPORT,
          note: `Imported live v${live.version} on ${exportedAt}.`,
        },
        { translate: 'none' },
      );
      await this.versioning.promote(
        prompt.id,
        created.version,
        prompt.currentVersion ?? null,
        {
          evalApproved: true,
          requireTranslations: false,
          confirmPinnedChange: true,
          // Copies a version that already went live in the store it was
          // exported from, so the pinned-editor check happened there.
          trustedImport: true,
        },
      );
      if (!result.created.includes(item.promptCode)) {
        result.updated.push(item.promptCode);
      }
    }

    // A draft already here (same text and settings) isn't imported twice,
    // so pulling into a local store again doesn't pile up copies.
    const existing = await this.dataSource.manager.find(PromptVersion, {
      where: { promptId: prompt.id },
      select: [
        'id',
        'prompt',
        'contentHash',
        'provider',
        'model',
        'temperature',
      ],
    });
    const versionKey = (v: {
      prompt: string;
      provider?: string | null;
      model?: string | null;
      temperature?: number | null;
    }) =>
      [
        hashPromptBody(v.prompt),
        v.provider ?? '',
        v.model ?? '',
        v.temperature ?? '',
      ].join('|');
    const have = new Set(existing.map(versionKey));
    for (const candidate of item.candidates ?? []) {
      const key = versionKey(candidate);
      if (have.has(key)) continue;
      have.add(key);
      await this.versioning.createVersion(
        prompt.id,
        {
          body: candidate.prompt,
          baseVersion: await this.versioning.latestVersionOf(prompt.id),
          provider: candidate.provider,
          model: candidate.model,
          temperature: candidate.temperature,
          source: PromptVersionSource.IMPORT,
          note: `Imported candidate v${candidate.version}${candidate.note ? `: ${candidate.note}` : ''}`,
        },
        { translate: 'none' },
      );
      result.candidates++;
    }
  }

  private async writeTranslations(
    promptId: string,
    translations: ExportedTranslation[] | undefined,
  ) {
    for (const t of translations ?? []) {
      await this.dataSource.manager.upsert(
        PromptTranslation,
        {
          promptId,
          languageId: t.languageId,
          sourceHash: t.sourceHash,
          translatedPrompt: t.translatedPrompt,
          status: PromptTranslationStatus.READY,
          runtimeProvider: t.runtimeProvider ?? undefined,
          runtimeModel: t.runtimeModel ?? undefined,
          provider: 'import',
          error: undefined,
        },
        { conflictPaths: ['promptId', 'languageId', 'sourceHash'] },
      );
    }
  }

  private async freeName(name: string): Promise<string> {
    const taken = await this.dataSource.manager.findOne(Prompt, {
      where: { name },
      select: ['id'],
    });
    return taken ? `${name} (imported)` : name;
  }

  private async requirePrompt(promptCode: string): Promise<Prompt> {
    const prompt = await this.dataSource.manager.findOne(Prompt, {
      where: { promptCode },
    });
    if (!prompt) {
      throw new NotFoundException(`No prompt with code ${promptCode}.`);
    }
    return prompt;
  }
}
