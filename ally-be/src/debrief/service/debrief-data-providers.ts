import { DebriefRecipeKey } from '../constants/debrief-release.constants';
import { DebriefContextRepository } from './debrief-context.repository';
import type { DebriefSessionContext } from './debrief-context.repository';
import { DebriefPracticeService } from './debrief-practice.service';

/**
 * The data layer a debrief run reads through (2026-11-18). Each piece of context data has ONE
 * provider: its single source, how it is loaded, what it falls back to, and the declared data item
 * it supplies (`DATA_ITEMS`, shown in Settings › Agents). The runner no longer wires loaders by
 * hand: it asks `loadDebriefData` for the lot, so a fallback, a condition or a failure note is
 * defined once, and a new input is one provider plus one declared item (a spec ties the two).
 *
 * Never throws and never blocks a debrief: a provider that fails gives its fallback and a note, so
 * a run that is missing data says so (`workspace.dataNotes`) instead of silently reading less.
 */
export interface ProviderInput {
  session: DebriefSessionContext;
  sessionId: string;
  recipeKey: string;
  orchestrated: boolean;
  /** The owner switch for learner progress. */
  progressOn: boolean;
  /** Reads the learner's progress profile (it needs the framework and competency names). */
  progressProfile: () => Promise<unknown>;
}

export interface DataProvider {
  /** The key the graph reads in `request.context`. */
  contextKey: string;
  /** The declared data item it supplies (`DATA_ITEMS`), or null for a count only the planner reads. */
  item: string | null;
  /** When false nothing is read and the fallback is used, without a note. */
  applies?: (i: ProviderInput) => boolean;
  load: (i: ProviderInput) => Promise<unknown>;
  fallback: unknown;
  /** Leave the key out of the request when the value is null. */
  omitWhenNull?: boolean;
}

export interface DataProblem {
  contextKey: string;
  item: string | null;
  why: string;
}

export function debriefDataProviders(deps: {
  context: DebriefContextRepository;
  practice: DebriefPracticeService;
}): DataProvider[] {
  const { context, practice } = deps;
  return [
    {
      contextKey: 'live_detections',
      item: 'live_detections',
      load: (i) => context.liveDetections(i.sessionId, i.session.scenarioId),
      fallback: [],
    },
    {
      contextKey: 'past_work_on_this',
      item: 'learner_history',
      applies: (i) => !!i.session.counselorId,
      load: (i) =>
        context.pastWorkOnThis(
          i.session.counselorId!,
          i.session.tenantId,
          i.sessionId,
        ),
      fallback: [],
    },
    {
      contextKey: 'cohort',
      item: 'cohort',
      load: (i) => context.cohortStats(i.session),
      fallback: null,
    },
    {
      contextKey: 'case_memory',
      item: 'case_memory',
      applies: (i) => i.recipeKey === DebriefRecipeKey.CASE,
      load: (i) => context.caseMemory(i.session.id),
      fallback: null,
    },
    {
      contextKey: 'practice_options',
      item: 'practice_options',
      load: (i) =>
        practice.optionsFor(
          i.session.counselorId,
          i.session.tenantId,
          i.sessionId,
        ),
      fallback: [],
    },
    {
      // What the orchestrator's planner may build on: cheap counts of what exists.
      contextKey: 'availability',
      item: null,
      applies: (i) => i.orchestrated,
      load: (i) => context.availability(i.session),
      fallback: null,
      omitWhenNull: true,
    },
    {
      contextKey: 'progress_profile',
      item: 'learner_history',
      applies: (i) => i.progressOn && !!i.session.counselorId,
      load: (i) => i.progressProfile(),
      fallback: null,
    },
  ];
}

/** Loads every provider in parallel; the request's `context` and what went wrong. */
export async function loadDebriefData(
  providers: readonly DataProvider[],
  input: ProviderInput,
): Promise<{ context: Record<string, unknown>; problems: DataProblem[] }> {
  const problems: DataProblem[] = [];
  const values = await Promise.all(
    providers.map(async (p) => {
      if (p.applies && !p.applies(input)) return p.fallback;
      try {
        return await p.load(input);
      } catch (e) {
        problems.push({
          contextKey: p.contextKey,
          item: p.item,
          why: (e as Error)?.message?.slice(0, 200) || 'could not be read',
        });
        return p.fallback;
      }
    }),
  );
  const context: Record<string, unknown> = {};
  providers.forEach((p, n) => {
    const v = values[n];
    if (p.omitWhenNull && v == null) return;
    context[p.contextKey] = v;
  });
  return { context, problems };
}
