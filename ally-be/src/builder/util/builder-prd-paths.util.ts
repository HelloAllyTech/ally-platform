import { BUILDER_REPO_NAMES } from '../constants/builder-repos.constants';
import {
  BuilderPrdDocument,
  BuilderPrdReadinessSection,
  BuilderReadinessSignals,
} from '../type/builder-prd.type';
import { prdSectionText } from './builder-prd-coverage.util';
import {
  citedPathMatchesRead,
  citedPaths,
} from './builder-readiness-checks.util';

/**
 * Every file path the PRD names, checked against the repo tree.
 *
 * Grounding claims went wrong in ways a tree lookup catches: React Native paths for an app that
 * is Flutter, a controller that does not exist, a table that is not the one the change touches.
 * The first two are a path that is not there. A path the PRD says it will create is fine — as
 * long as it says so on the same line, and the folder it lands in exists in that repo (a Flutter
 * app has no `src/`, so "new file ally-mobile/src/…" is still caught).
 *
 * Pure: the trees come in as data, so the rules are pinned by unit tests and the service only
 * fetches.
 */

/** A path the PRD cites, where, and whether it says the file is new. */
export interface PrdCitedPath {
  /** Service-relative when a repo is known, as written otherwise. */
  path: string;
  section: string;
  repo?: string;
  declaredNew: boolean;
}

/** Sections scanned, in reading order. The technical plan is scanned per repo entry. */
const SCANNED_SECTIONS = [
  'summary',
  'problem',
  'usersAndContext',
  'existingBehaviour',
  'whereChangesBelong',
  'goals',
  'nonGoals',
  'requirements',
  'assumptions',
  'testPlanMd',
  'e2ePlanMd',
  'dataModelMd',
  'apiMd',
];

/** A line that says the file is to be made, not that it exists. */
const DECLARES_NEW =
  /\b(new|create[sd]?|creating|add(?:s|ed|ing)?|introduce[sd]?|scaffold)\b/i;

/** Roots that live outside every service folder (the monorepo root, the wiki). */
const OUTSIDE_SERVICES = new Set(['.github', 'scripts', 'wiki']);

const SERVICES = new Set(BUILDER_REPO_NAMES);

/** Split `ally-be/src/x.ts` into its service and the path within it. */
function attribute(
  raw: string,
  defaultRepo?: string,
): { repo?: string; path: string } {
  const path = raw.replace(/^\.?\//, '').replace(/\/+$/, '');
  const first = path.split('/')[0];
  if (SERVICES.has(first)) {
    return { repo: first, path: path.slice(first.length + 1) };
  }
  return { repo: defaultRepo, path };
}

/** Paths in one block of text, each with whether its own line declares it new. */
function pathsIn(
  body: string,
  section: string,
  defaultRepo?: string,
): PrdCitedPath[] {
  const out: PrdCitedPath[] = [];
  for (const line of body.split('\n')) {
    for (const cited of citedPaths(line)) {
      if (/[*{}<>]|\.\.\./.test(cited)) continue; // globs and placeholders
      if (cited.startsWith('helloallytech.github.io')) continue;
      const { repo, path } = attribute(cited, defaultRepo);
      if (!path) continue;
      out.push({
        path,
        section,
        ...(repo ? { repo } : {}),
        declaredNew: DECLARES_NEW.test(line),
      });
    }
  }
  return out;
}

/** Every path the PRD cites, once per (repo, path, section). */
export function prdCitedPaths(draft: BuilderPrdDocument): PrdCitedPath[] {
  const found: PrdCitedPath[] = [];
  for (const section of SCANNED_SECTIONS) {
    found.push(...pathsIn(prdSectionText(draft, section), section));
  }
  for (const plan of draft.technicalPlan?.repos ?? []) {
    const repo = String(plan?.repo ?? '').trim();
    found.push(
      ...pathsIn(
        String(plan?.changesMd ?? ''),
        'technicalPlan',
        SERVICES.has(repo) ? repo : undefined,
      ),
    );
  }
  const seen = new Map<string, PrdCitedPath>();
  for (const entry of found) {
    const key = `${entry.repo ?? ''}|${entry.path}|${entry.section}`;
    const previous = seen.get(key);
    // The same path written twice in a section is new if either line says so.
    if (!previous || (entry.declaredNew && !previous.declaredNew)) {
      seen.set(key, entry);
    }
  }
  return [...seen.values()];
}

/** Whether `path` names a file or folder in `files` (service-relative paths). */
export function treeHas(files: Set<string>, path: string): boolean {
  if (files.has(path)) return true;
  const lower = path.toLowerCase();
  for (const file of files) {
    const candidate = file.toLowerCase();
    if (candidate === lower) return true;
    if (candidate.startsWith(`${lower}/`)) return true; // a folder
    // A partial path ("builder/service/x.ts", or a bare "DebriefTab.tsx").
    if (candidate.endsWith(`/${lower}`)) return true;
  }
  return false;
}

/** Whether the top-level folder a new file would land in exists. */
function landingExists(files: Set<string>, path: string): boolean {
  const segments = path.split('/').filter(Boolean);
  if (segments.length < 2) return true; // a bare name or a root file
  const top = `${segments[0].toLowerCase()}/`;
  for (const file of files) {
    if (file.toLowerCase().startsWith(top)) return true;
  }
  return false;
}

/**
 * Check every cited path. `trees` maps a service to its file list, or null when that tree could
 * not be read whole — paths in an unreadable tree are not checked, so a GitHub hiccup or a
 * truncated tree never reads as "missing".
 */
export function checkPrdPaths(
  paths: PrdCitedPath[],
  trees: Map<string, Set<string> | null>,
  readOk: string[] = [],
): NonNullable<BuilderReadinessSignals['paths']> {
  let checked = 0;
  const missing: { path: string; section: string; repo?: string }[] = [];
  for (const entry of paths) {
    const written = entry.repo ? `${entry.repo}/${entry.path}` : entry.path;
    // A file this session read exists, whatever the tree says.
    if (readOk.some((read) => citedPathMatchesRead(written, read))) {
      checked++;
      continue;
    }
    const first = entry.path.split('/')[0];
    if (!entry.repo && OUTSIDE_SERVICES.has(first)) continue;
    const candidates = entry.repo
      ? [trees.get(entry.repo)]
      : BUILDER_REPO_NAMES.map((repo) => trees.get(repo));
    const readable = candidates.filter(
      (files): files is Set<string> => !!files,
    );
    // Any unreadable candidate tree leaves the path unchecked: it may live there.
    if (!readable.length || readable.length < candidates.length) continue;
    checked++;
    if (readable.some((files) => treeHas(files, entry.path))) continue;
    if (
      entry.declaredNew &&
      readable.some((files) => landingExists(files, entry.path))
    ) {
      continue;
    }
    missing.push({
      path: written,
      section: entry.section,
      ...(entry.repo ? { repo: entry.repo } : {}),
    });
  }
  return { checked, missing };
}

/** The readiness row. Blocks on any path the repo does not have. */
export function pathsRow(
  signal: NonNullable<BuilderReadinessSignals['paths']>,
): BuilderPrdReadinessSection {
  const missing = signal.missing;
  const ok = missing.length === 0;
  const names = [...new Set(missing.map((entry) => entry.path))];
  return {
    key: 'pathsExist',
    label: 'Every path named exists',
    ok,
    hint: ok
      ? ''
      : `${names.length} path(s) in the PRD don't exist in the repo: ${
          names.length > 4
            ? `${names.slice(0, 4).join(', ')} and ${names.length - 4} more`
            : names.join(', ')
        }.`,
    detail: ok
      ? ''
      : 'These paths are not in the repo tree: ' +
        missing
          .slice(0, 12)
          .map((entry) => `${entry.path} (in ${entry.section})`)
          .join(', ') +
        '. Find the real path with github_search_code or github_repo_tree and correct the ' +
        'section. If a file is one the change creates, say "new" on the same line, and make sure ' +
        'the folder it goes in exists in that repo (ally-mobile is Flutter: Dart under lib/).',
  };
}
