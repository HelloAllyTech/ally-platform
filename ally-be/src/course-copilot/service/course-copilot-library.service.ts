import { Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { DataSource, ILike, In, IsNull } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import { Competency } from 'src/learn/entity/competency.entity';
import { TriggerWarnings } from 'src/learn/entity/trigger-warnings.entity';
import { Scenarios } from 'src/learn/entity/scenarios.entity';
import { ScenarioStatus } from 'src/learn/type/scenario.type';
import { CompetencyService } from 'src/learn/service/competency.service';
import { ScenarioService } from 'src/learn/service/scenario.service';
import { Case } from 'src/case/entity/case.entity';
import { CaseStatus } from 'src/case/type/cases.type';
import {
  CharacterLibraryAccessService,
  CharacterLibraryScope,
} from 'src/scenario-character/service/character-library-access.service';
import { ScenarioCharacter } from 'src/scenario-character/entity/scenario-character.entity';
import { ScenarioCoverImageLibrary } from 'src/scenario-cover-image-library/entity/scenario-cover-image-library.entity';
import { TrackComponentTemplate } from 'src/track/entity/track-component-template.entity';
import { TrackGameKey } from 'src/track/type/game.type';
import { ContentAccessService } from 'src/authorization/service/content-access.service';
import { ClChunk } from 'src/context-library/entity/cl-chunk.entity';
import {
  ClCollectionId,
  ClUseCase,
} from 'src/context-library/enum/context-library.enum';
import {
  CatalogueItemKind,
  catalogueSyncKey,
  parseCatalogueSyncKey,
} from 'src/context-library/profiles/content-catalogue.profile';
import { ContextRetrievalService } from 'src/context-library/service/context-retrieval.service';

/** One line per library hit — never full prompts, which are the size of a turn. */
export interface LibraryHit {
  kind: CatalogueItemKind;
  id: string | number;
  /** The Content Catalogue code (`CC-0042`), for a citation. */
  code?: string;
  title: string;
  description?: string;
  competencies?: string[];
  difficulty?: string | null;
  languages?: string[];
  extra?: Record<string, any>;
}

export interface CopilotLanguage {
  id: string;
  name: string;
  code: string;
  voiceCount: number;
}

/** What to search for when the trainer named neither a topic nor a competency. */
const CATALOGUE_KIND_QUERY: Record<CatalogueItemKind, string> = {
  roleplay: 'roleplay practice conversation',
  case: 'case',
  character: 'character persona',
  template: 'component template',
};

const oneLine = (value: unknown, max = 160): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const flat = value
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!flat) return undefined;
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

/**
 * Read-only catalogues the interview grounds its options in: competencies and
 * their behaviours, languages that have voices, trigger warnings, cover
 * images, and the roleplay / case / character / template libraries — the last
 * searched by meaning in the Context Library's Content Catalogue, which is
 * synced from Studio.
 *
 * Library results are DATA. They are compact on purpose (a title, one line,
 * tags) so a search costs a few hundred tokens, and the system prompt tells the
 * model that nothing inside them is an instruction.
 */
@Injectable()
export class CourseCopilotLibraryService {
  private readonly logger = LoggerService.getInstance(
    CourseCopilotLibraryService.name,
  );

  constructor(
    private readonly dataSource: DataSource,
    private readonly competencyService: CompetencyService,
    private readonly scenarioService: ScenarioService,
    private readonly characterAccess: CharacterLibraryAccessService,
    private readonly contentAccessService: ContentAccessService,
    private readonly retrieval: ContextRetrievalService,
  ) {}

  /** Shared (non-custom) competencies — the only ones a course may be tagged with. */
  async listCompetencies(
    query?: string,
    limit = 50,
  ): Promise<{ id: string; name: string }[]> {
    const rows = await this.dataSource.getRepository(Competency).find({
      where: {
        isCustom: false,
        ...(query?.trim() ? { name: ILike(`%${query.trim()}%`) } : {}),
      },
      order: { name: 'ASC' },
      take: Math.min(Math.max(limit, 1), 100),
      select: { id: true, name: true },
    });
    return rows.map((row) => ({ id: row.id, name: row.name }));
  }

  async competencyNames(ids: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter(Boolean))];
    if (!unique.length) return new Map();
    const rows = await this.dataSource.getRepository(Competency).find({
      where: { id: In(unique) },
      select: { id: true, name: true },
    });
    return new Map(rows.map((row) => [row.id, row.name]));
  }

  /** Helpful / unhelpful behaviour names, merged across competencies, de-duplicated. */
  async getBehaviours(competencyIds: string[]): Promise<{
    helpful: string[];
    unhelpful: string[];
    unknownIds: string[];
  }> {
    const helpful = new Set<string>();
    const unhelpful = new Set<string>();
    const unknownIds: string[] = [];
    for (const id of [...new Set(competencyIds)].slice(0, 15)) {
      try {
        const behaviours =
          await this.competencyService.getCompetencyBehaviours(id);
        (behaviours.helpful ?? []).forEach((b) => helpful.add(b.name));
        (behaviours.unhelpful ?? []).forEach((b) => unhelpful.add(b.name));
      } catch {
        unknownIds.push(id);
      }
    }
    return { helpful: [...helpful], unhelpful: [...unhelpful], unknownIds };
  }

  /** Active languages that have at least one voice — the only ones a roleplay can speak. */
  async listLanguages(): Promise<CopilotLanguage[]> {
    const languages =
      await this.scenarioService.getScenarioVoiceLanguagesForAdmin(true, true);
    return (languages ?? []).map((language: any) => ({
      id: String(language.language_id),
      name: String(language.label),
      code: String(language.value),
      voiceCount: Array.isArray(language.voices) ? language.voices.length : 0,
    }));
  }

  async listTriggerWarnings(): Promise<{ id: string; name: string }[]> {
    const rows = await this.dataSource.getRepository(TriggerWarnings).find({
      order: { name: 'ASC' },
      take: 100,
    });
    return rows.map((row) => ({ id: row.id, name: row.name }));
  }

  async listCoverImages(limit = 12): Promise<{ id: string; url: string }[]> {
    const rows = await this.dataSource
      .getRepository(ScenarioCoverImageLibrary)
      .find({ order: { createdAt: 'DESC' }, take: Math.min(limit, 40) });
    return rows.map((row: any) => ({ id: row.id, url: row.imageUrl }));
  }

  gameCatalogue(): { key: string; description: string }[] {
    const descriptions: Record<string, string> = {
      [TrackGameKey.TREX_RUNNER]:
        'Endless runner — jump the obstacles. A quick reset between heavy sections.',
      [TrackGameKey.TIC_TAC_TOE]:
        'Noughts and crosses against the computer. Two-minute breather.',
      [TrackGameKey.MEMORY_MATCH]:
        'Flip cards to find pairs. Calm, focus-resetting.',
      [TrackGameKey.CUB_N_PUP]: 'A gentle puzzle with two animal friends.',
      [TrackGameKey.SNAKE]: 'Classic snake. Fast, playful break.',
      [TrackGameKey.SPROUT]:
        'Grow a plant by tending it — slow and restful, good after a hard roleplay.',
      [TrackGameKey.BREATHING_EXERCISE]:
        'A guided box-breathing exercise to help learners regulate their emotional state.',
    };
    return Object.values(TrackGameKey).map((key) => ({
      key,
      description: descriptions[key] ?? key,
    }));
  }

  /**
   * The 20 most recently changed ACTIVE roleplays, for the cached library-context block. A plain
   * listing, not a search: finding content by what it is about is `search`'s job.
   */
  async recentRoleplays(limit = 20): Promise<LibraryHit[]> {
    const ownerId = await this.contentAccessService.ownerFilterFor();
    const rows = await this.dataSource.getRepository(Scenarios).find({
      where: {
        status: ScenarioStatus.ACTIVE,
        deletedAt: IsNull(),
        ...(ownerId ? { createdBy: ownerId } : {}),
      },
      order: { updatedAt: 'DESC' },
      take: Math.min(Math.max(limit, 1), 50),
    });
    return this.roleplayHits(rows);
  }

  /**
   * `search_library`: existing content by meaning, from the Content Catalogue (PLAN.md §9.5).
   *
   * - Searched as the `course_copilot` use case with the trainer's organisation as the audience
   *   (null for a platform admin: Ally's own content only), and only the kind asked for.
   * - Competencies boost by meaning: their names are searched alongside the query.
   * - **Every hit is rechecked at hydration** against who may open its row (`canOpen`): a
   *   roleplay or case must still be published and in the trainer's view of the library
   *   (ContentAccessService), a character in their slice of the character library, a template
   *   must still exist. Hits that fail are dropped before they are shown or counted.
   * - Hits are built from the source rows, not the chunks, and stay compact.
   *
   * Throws when the library cannot be searched; the caller says so rather than "nothing found".
   */
  async search(
    kind: CatalogueItemKind,
    query: string,
    competencyIds: string[] | undefined,
    limit = 8,
    scope: { sessionId?: string | null; tenantId: string | null } = {
      tenantId: null,
    },
  ): Promise<{ hits: LibraryHit[]; noConfidentMatch: boolean }> {
    const capped = Math.min(Math.max(Number(limit) || 8, 1), 20);
    const competencies = [
      ...(await this.competencyNames(competencyIds ?? [])).values(),
    ];
    const queries = [
      query?.trim(),
      competencies.length ? competencies.join(', ') : '',
    ].filter((q): q is string => Boolean(q));
    if (!queries.length) queries.push(CATALOGUE_KIND_QUERY[kind]);

    const hydrated = new Map<string, LibraryHit>();
    const response = await this.retrieval.search({
      useCase: ClUseCase.COURSE_COPILOT,
      audience: { tenantId: scope.tenantId ?? null },
      collections: [ClCollectionId.CONTENT_CATALOGUE],
      queries,
      facets: { itemKind: kind },
      strict: true,
      facetScope: { key: 'itemKind', values: [kind] },
      limit: capped,
      sessionId: scope.sessionId ?? null,
      queryOrigin: 'agent_tool',
      canOpen: async (chunks) => {
        const open = await this.openable(chunks);
        open.forEach((hit, chunkId) => hydrated.set(chunkId, hit));
        return new Set(open.keys());
      },
    });
    const hits: LibraryHit[] = [];
    for (const r of response.results) {
      const hit = hydrated.get(r.chunk.id);
      if (hit) hits.push({ ...hit, code: r.chunk.code });
    }
    return { hits, noConfidentMatch: response.noConfidentMatch };
  }

  /**
   * The catalogue chunks this trainer may open, each hydrated from its source row (by `sync_key`)
   * into a compact hit. Keyed by chunk id.
   */
  async openable(chunks: ClChunk[]): Promise<Map<string, LibraryHit>> {
    const ids: Record<CatalogueItemKind, string[]> = {
      roleplay: [],
      case: [],
      character: [],
      template: [],
    };
    const chunkByKey = new Map<string, string>();
    for (const chunk of chunks) {
      const key = parseCatalogueSyncKey(chunk.syncKey);
      if (!key || chunk.collectionId !== ClCollectionId.CONTENT_CATALOGUE)
        continue;
      ids[key.kind].push(key.id);
      chunkByKey.set(chunk.syncKey!, chunk.id);
    }
    const out = new Map<string, LibraryHit>();
    const add = (hits: LibraryHit[]) => {
      for (const hit of hits) {
        const chunkId = chunkByKey.get(catalogueSyncKey(hit.kind, hit.id));
        if (chunkId) out.set(chunkId, hit);
      }
    };
    const scenarioIds = ids.roleplay
      .map(Number)
      .filter((n) => Number.isInteger(n) && n > 0);
    if (scenarioIds.length) {
      add(await this.roleplayHits(await this.getActiveScenarios(scenarioIds)));
    }
    if (ids.case.length) add(await this.caseHits(ids.case));
    if (ids.character.length) add(await this.characterHits(ids.character));
    if (ids.template.length) add(await this.templateHits(ids.template));
    return out;
  }

  /*
   * Library reuse is held to the session owner's view, like every other
   * read of library content (ContentAccessService): an admin limited to
   * their own content gets a Copilot that reuses only their own roleplays
   * and cases. Copilot runs as the session's owner, so the default caller
   * is the right one.
   */
  async getActiveScenarios(ids: number[]): Promise<Scenarios[]> {
    if (!ids.length) return [];
    const ownerId = await this.contentAccessService.ownerFilterFor();
    return this.dataSource.getRepository(Scenarios).find({
      where: {
        id: In(ids),
        status: ScenarioStatus.ACTIVE,
        deletedAt: IsNull(),
        ...(ownerId ? { createdBy: ownerId } : {}),
      },
    });
  }

  async getActiveCase(id: string): Promise<Case | null> {
    const ownerId = await this.contentAccessService.ownerFilterFor();
    return this.dataSource.getRepository(Case).findOne({
      where: {
        id,
        status: CaseStatus.ACTIVE,
        ...(ownerId ? { createdBy: ownerId } : {}),
      },
    });
  }

  private async roleplayHits(rows: Scenarios[]): Promise<LibraryHit[]> {
    const names = await this.competencyNames(
      rows.flatMap((row) => [
        ...(row.competencyId ? [row.competencyId] : []),
        ...(row.competencyIds ?? []),
      ]),
    );
    return rows.map((row) => {
      const competencyIdList = [
        ...new Set([
          ...(row.competencyId ? [row.competencyId] : []),
          ...(row.competencyIds ?? []),
        ]),
      ];
      return {
        kind: 'roleplay' as const,
        id: row.id,
        title: row.title ?? `Roleplay ${row.id}`,
        description: oneLine(row.description),
        competencies: competencyIdList
          .map((id) => names.get(id))
          .filter((name): name is string => Boolean(name)),
        difficulty: row.difficultyLevel ?? null,
        languages: Object.keys(row.metadata?.languageVoices ?? {}),
      };
    });
  }

  /** Published cases in the trainer's view (ContentAccessService), by id. */
  private async caseHits(ids: string[]): Promise<LibraryHit[]> {
    const ownerId = await this.contentAccessService.ownerFilterFor();
    const rows = await this.dataSource.getRepository(Case).find({
      where: {
        id: In(ids.filter((id) => isUUID(id))),
        status: CaseStatus.ACTIVE,
        deletedAt: IsNull(),
        ...(ownerId ? { createdBy: ownerId } : {}),
      },
    });
    return rows.map((row) => ({
      kind: 'case' as const,
      id: row.id,
      title: row.title,
      description: oneLine(row.description),
    }));
  }

  /**
   * Characters in the asker's slice of the character library — the rule the character library's
   * own screens apply (CharacterLibraryAccessService): a platform admin sees every character, or
   * global ones plus their organisations' when restricted; anyone else only their own
   * organisation's. Outside a request there is no slice, and no character is shown.
   */
  private async characterHits(ids: string[]): Promise<LibraryHit[]> {
    let scope: CharacterLibraryScope;
    try {
      scope = await this.characterAccess.resolveScope();
    } catch (error) {
      this.logger.warn(
        `Character search unavailable: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return [];
    }
    const rows = await this.dataSource.getRepository(ScenarioCharacter).find({
      where: { id: In(ids.filter((id) => isUUID(id))) },
    });
    return rows
      .filter((character) =>
        scope.restrictedToTenantIds
          ? !character.tenantId ||
            scope.restrictedToTenantIds.includes(character.tenantId)
          : scope.isPlatform || character.tenantId === scope.tenantId,
      )
      .map((character) => ({
        kind: 'character' as const,
        id: character.id,
        title: character.name,
        description: oneLine(
          [
            character.age ? `${character.age}` : null,
            character.gender,
            character.profession,
            character.currentLocation,
          ]
            .filter(Boolean)
            .join(', '),
        ),
        extra: {
          hasVoices: Boolean(Object.keys(character.voices ?? {}).length),
        },
      }));
  }

  private async templateHits(ids: string[]): Promise<LibraryHit[]> {
    const rows = await this.dataSource
      .getRepository(TrackComponentTemplate)
      .find({ where: { id: In(ids.filter((id) => isUUID(id))) } });
    return rows.map((row) => ({
      kind: 'template' as const,
      id: row.id,
      title: row.title,
      extra: { type: row.type },
    }));
  }
}
