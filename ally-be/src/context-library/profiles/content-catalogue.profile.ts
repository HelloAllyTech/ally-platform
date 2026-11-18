import {
  ClChunkOrigin,
  ClCollectionId,
  ClUseCase,
} from '../enum/context-library.enum';
import { CollectionProfile, ProfileChunkView } from './profile.types';
import { firstFacet, joinList } from './profile.util';

/** The four kinds of Studio content Course Copilot can reuse in a course. */
export const CATALOGUE_ITEM_KINDS = [
  'roleplay',
  'case',
  'character',
  'template',
] as const;

export type CatalogueItemKind = (typeof CATALOGUE_ITEM_KINDS)[number];

/**
 * The Studio table behind each kind. A synced chunk's `sync_key` is `<table>:<row id>`, which is
 * how a hit is hydrated back to the row it mirrors and rechecked against who may open it.
 */
export const CATALOGUE_TABLES: Readonly<Record<CatalogueItemKind, string>> = {
  roleplay: 'scenarios',
  case: 'cases',
  character: 'scenario_characters',
  template: 'track_component_templates',
};

export const CATALOGUE_KIND_BY_TABLE: Readonly<
  Record<string, CatalogueItemKind>
> = Object.fromEntries(
  Object.entries(CATALOGUE_TABLES).map(([kind, table]) => [table, kind]),
) as Record<string, CatalogueItemKind>;

/** `scenarios:42` → `{ table: 'scenarios', id: '42', kind: 'roleplay' }`; anything else → null. */
export function parseCatalogueSyncKey(
  syncKey: string | null | undefined,
): { table: string; id: string; kind: CatalogueItemKind } | null {
  const at = (syncKey ?? '').indexOf(':');
  if (at <= 0) return null;
  const table = syncKey!.slice(0, at);
  const id = syncKey!.slice(at + 1);
  const kind = CATALOGUE_KIND_BY_TABLE[table];
  return kind && id ? { table, id, kind } : null;
}

export function catalogueSyncKey(kind: CatalogueItemKind, id: string | number) {
  return `${CATALOGUE_TABLES[kind]}:${id}`;
}

/** A title and its one line, never a whole description: an item is found, not read here. */
export const CATALOGUE_STATEMENT_MAX_CHARS = 300;

/**
 * Course Copilot's catalogue of reusable Studio content — every active roleplay, case, character
 * and component template — synced from its source tables (PLAN.md §6.4). `search_library` reads it
 * by meaning, scoped to the trainer's organisation, and every hit is rechecked against who may
 * open the row before it is shown.
 *
 * The text belongs to the source table: no person edits it here and no loop rewrites or archives
 * it. Enrichment adds example searches beside it. Audience follows the item's owner: an Ally-owned
 * item is global, an organisation's own item reaches only that organisation.
 */
export const CONTENT_CATALOGUE_PROFILE: CollectionProfile = {
  id: ClCollectionId.CONTENT_CATALOGUE,
  name: 'Content Catalogue',
  purpose:
    'One entry per reusable piece of Studio content — a roleplay, a case, a character or a ' +
    'component template — with its title, one line about it, competencies, difficulty and ' +
    'languages. Its reader is Course Copilot looking for existing content to reuse in a course ' +
    'for mental-health helpers; the query describes what the course needs. An item is relevant ' +
    'when a trainer could use it for that need as it stands; one on the same topic that would ' +
    'not serve that need is tangential.',
  noun: 'item',
  nounPlural: 'items',
  codePrefix: 'CC',
  allowedOrigins: [ClChunkOrigin.SYNCED],
  // Organisations' own items (a character an organisation made) reach only that organisation.
  // Nobody writes here by hand, organisations included: the org Library lists only collections
  // that take written entries.
  allowsOrgChunks: true,
  // Granted only to Course Copilot (PLAN.md §2.2). Tenant content never reaches engineers'
  // editors, and no other agent has a use for it.
  neverGrantTo: [
    ClUseCase.MCP_DEV,
    ClUseCase.BUILDER_INTERVIEW,
    ClUseCase.BUILDER_RESEARCH,
    ClUseCase.BUILDER_PRD_REVIEW,
    ClUseCase.BUILDER_BRIEF,
    ClUseCase.BUILDER_BUILD,
    ClUseCase.BUG_HUNTER,
    ClUseCase.ROADMAP_COPILOT,
    ClUseCase.CHARACTER_INTERVIEW,
    ClUseCase.ALLY_GUIDE,
    ClUseCase.DEBRIEF,
  ],
  statementMaxChars: CATALOGUE_STATEMENT_MAX_CHARS,
  facets: {
    itemKind: {
      label: 'Kind',
      values: CATALOGUE_ITEM_KINDS,
      valueLabels: {
        roleplay: 'Roleplay',
        case: 'Case',
        character: 'Character',
        template: 'Component template',
      },
      multi: false,
      required: true,
    },
    // Competency names as Studio shows them. Free text: the competency list is Studio's own.
    competencies: { label: 'Competencies', multi: true },
    difficulty: { label: 'Difficulty', multi: false },
    // Language codes a roleplay has voices for.
    languages: { label: 'Languages', multi: true },
  },
  attributes: {
    title: { label: 'Title', type: 'text', maxChars: 200, shown: true },
    summary: { label: 'About it', type: 'text', maxChars: 200, shown: true },
    // Retrieval-only: the competency ids behind the names, which `search_library` filters on.
    competencyIds: { label: 'Competency ids', type: 'text[]', shown: false },
    // A component template's item type (quiz, article…); a character's details line.
    detail: { label: 'Detail', type: 'text', maxChars: 200, shown: true },
  },
  densityCap: { perSegment: 0, min: 0, max: 0 },
  retrievalDefaults: {
    weights: { bm25: 1, statement: 1, situations: 1 },
    rerank: true,
    mmrLambda: 0.7,
    contextualise: false,
  },
  statementText: (c: ProfileChunkView) =>
    [
      firstFacet(c, 'itemKind'),
      c.statement,
      joinList(c.facets?.competencies as string[] | undefined),
    ]
      .filter(Boolean)
      .join(': ')
      .trim(),
  situationsText: (c: ProfileChunkView) =>
    [
      firstFacet(c, 'itemKind'),
      joinList(c.facets?.competencies as string[] | undefined),
      String(c.attributes.detail ?? ''),
      joinList(c.situations),
      joinList(c.exampleQueries),
    ]
      .filter(Boolean)
      .join(' · '),
  card: (c: ProfileChunkView, band?: string) => {
    const head = [c.code, firstFacet(c, 'itemKind'), band ?? '']
      .filter(Boolean)
      .join(' · ');
    const tags = [
      joinList(c.facets?.competencies as string[] | undefined),
      firstFacet(c, 'difficulty'),
      joinList(c.facets?.languages as string[] | undefined),
    ]
      .filter(Boolean)
      .join(' · ');
    return `[${head}] ${c.statement}${tags ? `\n  ${tags}` : ''}`;
  },
};
