import { DataSource, In, Repository } from 'typeorm';
import { Injectable } from '@nestjs/common';
import {
  PromptTranslation,
  PromptTranslationStatus,
} from '../entity/prompt-translation.entity';
import { Prompt } from '../entity/prompt.entity';

/** One row per requested prompt code (translation columns null when absent). */
export interface RuntimeTranslationRow {
  promptCode: string;
  promptId: string;
  translationEnabled: boolean;
  promptType: string | null;
  translatedPrompt: string | null;
  sourceHash: string | null;
  status: PromptTranslationStatus | null;
  runtimeProvider: string | null;
  runtimeModel: string | null;
}

@Injectable()
export class PromptTranslationRepository extends Repository<PromptTranslation> {
  constructor(private dataSource: DataSource) {
    super(PromptTranslation, dataSource.createEntityManager());
  }

  /**
   * For each prompt code + the hash of the English body about to ship, return
   * the prompt with the translation of THAT body for one language (null
   * translation columns when there is none). Every requested code returns a
   * row, carrying `translationEnabled`/`promptType` for gating + self-heal.
   */
  async getRuntimeRows(
    hashByCode: Record<string, string>,
    languageId: number,
  ): Promise<RuntimeTranslationRow[]> {
    const promptCodes = Object.keys(hashByCode);
    if (!promptCodes.length) return [];
    const prompts = await this.manager
      .createQueryBuilder(Prompt, 'p')
      .where('p."promptCode" IN (:...promptCodes)', { promptCodes })
      .select(['p.id', 'p.promptCode', 'p.translationEnabled', 'p.promptType'])
      .getMany();
    if (!prompts.length) return [];
    const translations = await this.find({
      where: {
        promptId: In(prompts.map((p) => p.id)),
        languageId,
        sourceHash: In([...new Set(Object.values(hashByCode))]),
      },
    });
    return prompts.map((p) => {
      const t = translations.find(
        (row) =>
          row.promptId === p.id && row.sourceHash === hashByCode[p.promptCode],
      );
      return {
        promptCode: p.promptCode,
        promptId: p.id,
        translationEnabled: !!p.translationEnabled,
        promptType: p.promptType ?? null,
        translatedPrompt: t?.translatedPrompt ?? null,
        sourceHash: t?.sourceHash ?? null,
        status: t?.status ?? null,
        runtimeProvider: t?.runtimeProvider ?? null,
        runtimeModel: t?.runtimeModel ?? null,
      };
    });
  }

  /** The translation of one English body (by hash) for one language. */
  findForBody(
    promptId: string,
    languageId: number,
    sourceHash: string,
  ): Promise<PromptTranslation | null> {
    return this.findOne({ where: { promptId, languageId, sourceHash } });
  }

  /** Every language's translation of one English body. */
  findAllForBody(
    promptId: string,
    sourceHash: string,
  ): Promise<PromptTranslation[]> {
    return this.find({
      where: { promptId, sourceHash },
      order: { languageId: 'ASC' },
    });
  }

  /** The runtime model last set for a language, carried onto a new body's row. */
  async latestRuntimeModel(
    promptId: string,
    languageId: number,
  ): Promise<{ runtimeProvider?: string; runtimeModel?: string } | null> {
    const row = await this.findOne({
      where: { promptId, languageId },
      order: { updatedAt: 'DESC' },
      select: ['id', 'runtimeProvider', 'runtimeModel'],
    });
    if (!row?.runtimeModel && !row?.runtimeProvider) return null;
    return {
      runtimeProvider: row.runtimeProvider ?? undefined,
      runtimeModel: row.runtimeModel ?? undefined,
    };
  }

  /**
   * Insert or update the row for one (prompt, language, English body). Only
   * the provided fields are written.
   */
  async upsertTranslation(
    input: Partial<PromptTranslation> &
      Pick<
        PromptTranslation,
        'promptId' | 'languageId' | 'sourceHash' | 'status'
      >,
  ): Promise<void> {
    await this.upsert(input, {
      conflictPaths: ['promptId', 'languageId', 'sourceHash'],
      skipUpdateIfNoValuesChanged: true,
    });
  }

  async markStatus(
    promptId: string,
    languageId: number,
    sourceHash: string,
    status: PromptTranslationStatus,
    error?: string,
  ): Promise<void> {
    await this.update({ promptId, languageId, sourceHash }, { status, error });
  }

  /**
   * Set (or clear, with null) the runtime provider/model for one (prompt,
   * language) — the model that runs the main agent when this translated body is
   * served. Applies to every body's row for that language, live and candidate.
   * No-op when nothing has been translated yet.
   */
  async setRuntimeModel(
    promptId: string,
    languageId: number,
    runtimeProvider: string | null,
    runtimeModel: string | null,
  ): Promise<void> {
    // null clears the override (back to the prompt's own model); TypeORM skips
    // `undefined` but writes `null`, so cast to allow the null write.
    await this.update({ promptId, languageId }, {
      runtimeProvider,
      runtimeModel,
    } as unknown as Partial<PromptTranslation>);
  }
}
