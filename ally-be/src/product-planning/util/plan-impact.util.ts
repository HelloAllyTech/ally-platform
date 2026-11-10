import type { PlanImpactTag, PlanImpactTagId } from '../type/plan-record.type';

/**
 * Code paths that, when a plan touches them, add an impact tag the lead cannot
 * remove (rev 5.2 §B.8.4). Matched as substrings of repo-relative paths the
 * PRD or design names. Kept in code, next to the checks they trigger.
 */
export const IMPACT_PATH_MAP: { pattern: RegExp; tag: PlanImpactTagId }[] = [
  { pattern: /(^|\/)guide\/safety\//, tag: 'crisis_or_helpline_path' },
  { pattern: /(^|\/)helpline\//, tag: 'crisis_or_helpline_path' },
  {
    pattern: /(^|\/)conversational-guardrails\//,
    tag: 'learner_or_client_facing_ai',
  },
  {
    pattern:
      /(^|\/)(audio|audio-ingest|transcript|transcript-translation|scribe-session-review)\//,
    tag: 'recordings_or_transcripts',
  },
  {
    pattern: /(^|\/)(auth|authorization)\//,
    tag: 'stores_or_moves_personal_data',
  },
  { pattern: /(^|\/)tenant\//, tag: 'cross_tenant' },
  { pattern: /(^|\/)prompts?\//, tag: 'prompt_or_model_change' },
  { pattern: /(^|\/)llm(-agent)?\//, tag: 'prompt_or_model_change' },
  {
    pattern: /(^|\/)(debrief|learn|roleplay-session-logs|scenario-report)\//,
    tag: 'learner_or_client_facing_ai',
  },
  { pattern: /^ally-mobile(-flutter)?\//, tag: 'mobile' },
  { pattern: /^ally-web\/|\.tsx$/, tag: 'ui_change' },
  { pattern: /^ally-ai(-learn)?\//, tag: 'prompt_or_model_change' },
];

/** The tags code adds for these paths, each with the first path that matched. */
export function tagsForPaths(
  paths: string[],
  at = new Date().toISOString(),
): PlanImpactTag[] {
  const found = new Map<PlanImpactTagId, string>();
  for (const path of paths) {
    for (const { pattern, tag } of IMPACT_PATH_MAP) {
      if (!found.has(tag) && pattern.test(path)) found.set(tag, path);
    }
  }
  return [...found.entries()].map(([id, path]) => ({
    id,
    source: 'code' as const,
    reason: path,
    at,
  }));
}

/**
 * Merge a lead's chosen tags with code's: code tags always stay; lead tags are
 * replaced by the lead's new choice. Never removes a code tag, whatever the
 * lead sends.
 */
export function mergeImpactTags(
  current: PlanImpactTag[],
  leadChoice: PlanImpactTagId[],
  codeTags: PlanImpactTag[],
  leadUserId: number,
  at = new Date().toISOString(),
): PlanImpactTag[] {
  const code = new Map<PlanImpactTagId, PlanImpactTag>();
  for (const tag of [
    ...current.filter((t) => t.source === 'code'),
    ...codeTags,
  ]) {
    if (!code.has(tag.id)) code.set(tag.id, tag);
  }
  const lead = leadChoice
    .filter((id) => !code.has(id))
    .map((id) => ({
      id,
      source: 'lead' as const,
      reason: `chosen by user ${leadUserId}`,
      at: current.find((t) => t.id === id && t.source === 'lead')?.at ?? at,
    }));
  return [...code.values(), ...lead];
}
