import { createHash } from 'crypto';
import {
  PolicySchema,
  PolicyValue,
  applyPolicyValues,
  flattenPolicy,
  invalidValueReason,
} from 'src/llm-agent/harness/config/policy-schema';
import { AgentLessonScope } from 'src/llm-agent/harness/enum/learning.enum';
import {
  GuideLoopPolicy,
  GuidePlaybookLesson,
  GuideReleaseBundle,
  GuideRole,
} from 'src/guide/release/guide-release.bundle';
import { CopiedTextIndex } from './copied-text';
import { EvidenceCluster, evidenceSuffices } from './evidence';
import { safetyTermsIn } from './safety-vocabulary';

/**
 * The curator's guardrails (plans/ally-guide/plan.md §7.13). Pure, so each
 * rule is tested on its own and a person can read exactly why a change was
 * refused. Nothing the model writes reaches a release without passing every
 * one of them:
 *
 *  - evidence: a change cites a cluster whose evidence meets its scope's bar;
 *  - pinned: no pinned key, no Safety or Learning-loop key, no safety-core
 *    prompt; values inside the schema's range;
 *  - copied text: no run of 8 words shared with a learner's message;
 *  - safety vocabulary: anything that touches it waits for a person;
 *  - caps: 60 platform, 15 per organisation, 10 per course lessons;
 *  - at most 5 changes in one release.
 */

export type ChangeKind = 'lesson' | 'policy' | 'prompt';

export interface ProposedChange {
  kind: ChangeKind;
  /** The evidence cluster the model cited. */
  clusterId: string;
  /** The lesson itself, or a one-line summary of a tweak. */
  text: string;
  rationale: string;
  policy?: { key: string; value: PolicyValue };
  prompt?: { role: string; find: string; replace: string };
  /**
   * A lesson a person cleared from quarantine, carried into this proposal.
   * Its evidence and vocabulary were judged when it was first proposed.
   */
  approved?: {
    lessonId: string;
    scope: AgentLessonScope;
    tenantId: string | null;
    trackId: string | null;
    learners: number;
  };
}

export type BlockReason =
  | 'unknown_evidence'
  | 'evidence'
  | 'length'
  | 'scope'
  | 'unknown_key'
  | 'pinned'
  | 'protected_group'
  | 'out_of_range'
  | 'no_change'
  | 'safety_core'
  | 'protected_role'
  | 'find_not_unique'
  | 'copied_text'
  | 'cap'
  | 'release_full'
  | 'duplicate';

export interface ChangeVerdict {
  change: ProposedChange;
  outcome: 'accept' | 'quarantine' | 'block';
  reason: BlockReason | 'safety_vocabulary' | null;
  why: string;
  scope: AgentLessonScope;
  tenantId: string | null;
  trackId: string | null;
  /** For ordering and the audit: learners behind the change. */
  learners: number;
  evidence: Record<string, unknown>;
  /** A policy tweak's current value, for the audit. */
  from?: PolicyValue;
}

/** Lesson text limits: long enough to be specific, short enough for S1. */
export const LESSON_MIN_CHARS = 20;
export const LESSON_MAX_CHARS = 280;
/** A prompt tweak replaces one passage of at most this many characters. */
export const PROMPT_REPLACE_MAX_CHARS = 600;

/**
 * Prompts the curator may tweak. The Sentinel's is the safety core (§6.1);
 * the evaluator's and red team's are not in the bundle at all, so the loop
 * can never soften the tests that judge it.
 */
export const CURATOR_EDITABLE_ROLES: readonly GuideRole[] = [
  'orchestrator',
  'tutor',
  'coach',
  'assessor',
  'summariser',
  'outreach_writer',
  'memory_curator',
];
export const SAFETY_CORE_ROLES: readonly string[] = ['sentinel'];

/** Policy groups the curator never touches, pinned or not. */
export const CURATOR_PROTECTED_GROUPS: readonly string[] = [
  'Safety',
  'Learning loop',
];

export function changeHash(
  change: Pick<ProposedChange, 'kind' | 'text' | 'policy' | 'prompt'>,
  target: { scope: string; tenantId: string | null; trackId: string | null },
): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        change.kind,
        target.scope,
        target.tenantId,
        target.trackId,
        change.kind === 'lesson' ? change.text.trim().toLowerCase() : null,
        change.policy ?? null,
        change.prompt ?? null,
      ]),
    )
    .digest('hex');
}

export interface VetInput {
  changes: ProposedChange[];
  clusters: Map<string, EvidenceCluster>;
  /** The GA bundle the candidate is built on. */
  bundle: GuideReleaseBundle;
  schema: PolicySchema;
  copied: CopiedTextIndex;
  /** Lessons already in the GA playbook (and not retired), per scope target. */
  activeCounts: ScopeCounts;
  /** Content hashes already proposed, active or quarantined. */
  knownHashes: Set<string>;
  policy: GuideLoopPolicy;
}

export interface ScopeCounts {
  platform: number;
  org: Map<string, number>;
  course: Map<string, number>;
}

export function countPlaybook(lessons: GuidePlaybookLesson[]): ScopeCounts {
  const counts: ScopeCounts = {
    platform: 0,
    org: new Map(),
    course: new Map(),
  };
  for (const lesson of lessons) {
    if (lesson.scope === 'platform') counts.platform++;
    else if (lesson.scope === 'org' && lesson.tenantId) {
      counts.org.set(
        lesson.tenantId,
        (counts.org.get(lesson.tenantId) ?? 0) + 1,
      );
    } else if (lesson.scope === 'course' && lesson.trackId) {
      counts.course.set(
        lesson.trackId,
        (counts.course.get(lesson.trackId) ?? 0) + 1,
      );
    }
  }
  return counts;
}

/** Judge each change on its own, then apply the caps and the release limit. */
export function vetChanges(input: VetInput): ChangeVerdict[] {
  const verdicts = input.changes.map((change) => vetOne(change, input));
  return applyLimits(verdicts, input.activeCounts, input.policy);
}

function vetOne(change: ProposedChange, input: VetInput): ChangeVerdict {
  const { policy } = input;
  const cluster = change.approved
    ? null
    : (input.clusters.get(change.clusterId) ?? null);
  const scope = change.approved?.scope ?? cluster?.scope;
  const base = {
    change,
    scope: scope ?? AgentLessonScope.PLATFORM,
    tenantId: change.approved?.tenantId ?? cluster?.tenantId ?? null,
    trackId: change.approved?.trackId ?? cluster?.trackId ?? null,
    learners: change.approved?.learners ?? cluster?.learners ?? 0,
    evidence: cluster
      ? {
          clusterId: cluster.id,
          signal: cluster.signal,
          turns: cluster.turns,
          learners: cluster.learners,
          tenants: cluster.tenants,
          sources: cluster.sources,
          evaluationIds: cluster.evaluationIds,
        }
      : change.approved
        ? { approvedLessonId: change.approved.lessonId }
        : { clusterId: change.clusterId },
  };
  const block = (reason: BlockReason, why: string): ChangeVerdict => ({
    ...base,
    outcome: 'block',
    reason,
    why,
  });

  if (!change.approved) {
    if (!cluster) {
      return block(
        'unknown_evidence',
        `cites evidence ${change.clusterId}, which this run did not offer`,
      );
    }
    const evidence = evidenceSuffices(cluster, policy);
    if (!evidence.ok) return block('evidence', evidence.why);
  }

  const text = change.text.trim();
  let from: PolicyValue | undefined;
  const probe: string[] = [text];

  if (change.kind === 'lesson') {
    if (text.length < LESSON_MIN_CHARS || text.length > LESSON_MAX_CHARS) {
      return block(
        'length',
        `a lesson is ${LESSON_MIN_CHARS}–${LESSON_MAX_CHARS} characters; this is ${text.length}`,
      );
    }
  } else if (change.kind === 'policy') {
    if (base.scope !== AgentLessonScope.PLATFORM) {
      return block(
        'scope',
        'release policy is platform-wide; organisation and course values are set in their own layers, by people',
      );
    }
    const key = change.policy?.key ?? '';
    const spec = input.schema[key];
    if (!spec)
      return block('unknown_key', `${key || '(none)'} is not a policy key`);
    if (spec.pinned) return block('pinned', `${key} is pinned`);
    if (CURATOR_PROTECTED_GROUPS.includes(spec.group)) {
      return block(
        'protected_group',
        `${key} is in ${spec.group}, which the curator never changes`,
      );
    }
    const invalid = invalidValueReason(spec, change.policy!.value);
    if (invalid) return block('out_of_range', `${key} ${invalid}`);
    from = flattenPolicy(input.bundle.policy)[key] as PolicyValue;
    if (from === change.policy!.value) {
      return block('no_change', `${key} is already ${String(from)}`);
    }
  } else {
    if (base.scope !== AgentLessonScope.PLATFORM) {
      return block('scope', 'prompts are platform-wide');
    }
    const prompt = change.prompt;
    if (!prompt) return block('unknown_key', 'no prompt tweak given');
    if (SAFETY_CORE_ROLES.includes(prompt.role)) {
      return block(
        'safety_core',
        `the ${prompt.role} prompt is the safety core`,
      );
    }
    if (!CURATOR_EDITABLE_ROLES.includes(prompt.role as GuideRole)) {
      return block(
        'protected_role',
        `the ${prompt.role} prompt is not the curator's to change`,
      );
    }
    const current = input.bundle.prompts[prompt.role as GuideRole]?.text ?? '';
    const occurrences = prompt.find ? current.split(prompt.find).length - 1 : 0;
    if (occurrences !== 1) {
      return block(
        'find_not_unique',
        `the passage to replace occurs ${occurrences} times in the ${prompt.role} prompt; it must occur exactly once`,
      );
    }
    if (
      !prompt.replace.trim() ||
      prompt.replace.length > PROMPT_REPLACE_MAX_CHARS
    ) {
      return block(
        'length',
        `a replacement is 1–${PROMPT_REPLACE_MAX_CHARS} characters`,
      );
    }
    probe.push(prompt.replace, prompt.find);
  }

  const copied = [text, change.prompt?.replace]
    .map((t) => input.copied.firstCopied(t))
    .find(Boolean);
  if (copied) {
    return block(
      'copied_text',
      `shares ${policy.copyNgram} words in a row with a learner's message`,
    );
  }

  const hash = changeHash(change, base);
  if (!change.approved && input.knownHashes.has(hash)) {
    return block(
      'duplicate',
      'the same change is already proposed, active or waiting',
    );
  }

  if (!change.approved) {
    const terms = [...new Set(probe.flatMap((t) => safetyTermsIn(t)))];
    if (change.kind === 'policy') {
      const spec = input.schema[change.policy!.key];
      terms.push(...safetyTermsIn(spec?.description));
    }
    if (terms.length) {
      return {
        ...base,
        outcome: 'quarantine',
        reason: 'safety_vocabulary',
        why: `touches safety vocabulary (${[...new Set(terms)].slice(0, 5).join(', ')}): a person decides`,
        ...(from !== undefined ? { from } : {}),
      };
    }
  }

  return {
    ...base,
    outcome: 'accept',
    reason: null,
    why: change.approved
      ? 'cleared from quarantine by a person'
      : evidenceSuffices(input.clusters.get(change.clusterId)!, policy).why,
    ...(from !== undefined ? { from } : {}),
  };
}

/**
 * Caps and the release limit, in priority order: lessons a person already
 * cleared first, then the best-evidenced. A lesson over its scope's cap, or a
 * change past the fifth, is blocked — the curator proposes again tomorrow.
 * Two tweaks to the same policy key or prompt in one release: the first wins.
 */
function applyLimits(
  verdicts: ChangeVerdict[],
  active: ScopeCounts,
  policy: GuideLoopPolicy,
): ChangeVerdict[] {
  const order = verdicts
    .map((verdict, index) => ({ verdict, index }))
    .sort(
      (a, b) =>
        Number(Boolean(b.verdict.change.approved)) -
          Number(Boolean(a.verdict.change.approved)) ||
        b.verdict.learners - a.verdict.learners ||
        a.index - b.index,
    );
  const counts: ScopeCounts = {
    platform: active.platform,
    org: new Map(active.org),
    course: new Map(active.course),
  };
  const touched = new Set<string>();
  let accepted = 0;
  const out = [...verdicts];
  for (const { verdict, index } of order) {
    if (verdict.outcome !== 'accept') continue;
    const block = (reason: BlockReason, why: string) => {
      out[index] = { ...verdict, outcome: 'block', reason, why };
    };
    const { change } = verdict;
    const tweakKey =
      change.kind === 'policy'
        ? `policy:${change.policy!.key}`
        : change.kind === 'prompt'
          ? `prompt:${change.prompt!.role}:${change.prompt!.find}`
          : null;
    if (tweakKey && touched.has(tweakKey)) {
      block(
        'duplicate',
        'another change in this release already edits the same thing',
      );
      continue;
    }
    if (change.kind === 'lesson') {
      const cap = capFor(verdict, counts, policy);
      if (cap.used >= cap.max) {
        block(
          'cap',
          `the ${cap.label} playbook is full (${cap.used} of ${cap.max}); retire a lesson to make room`,
        );
        continue;
      }
    }
    if (accepted >= policy.maxChangesPerRelease) {
      block(
        'release_full',
        `a release carries at most ${policy.maxChangesPerRelease} changes`,
      );
      continue;
    }
    accepted++;
    if (tweakKey) touched.add(tweakKey);
    if (change.kind === 'lesson') bump(verdict, counts);
  }
  return out;
}

function capFor(
  verdict: ChangeVerdict,
  counts: ScopeCounts,
  policy: GuideLoopPolicy,
): { used: number; max: number; label: string } {
  if (verdict.scope === AgentLessonScope.ORG) {
    return {
      used: counts.org.get(verdict.tenantId ?? '') ?? 0,
      max: policy.lessonCapOrg,
      label: 'organisation',
    };
  }
  if (verdict.scope === AgentLessonScope.COURSE) {
    return {
      used: counts.course.get(verdict.trackId ?? '') ?? 0,
      max: policy.lessonCapCourse,
      label: 'course',
    };
  }
  return {
    used: counts.platform,
    max: policy.lessonCapPlatform,
    label: 'platform',
  };
}

function bump(verdict: ChangeVerdict, counts: ScopeCounts) {
  if (verdict.scope === AgentLessonScope.ORG && verdict.tenantId) {
    counts.org.set(
      verdict.tenantId,
      (counts.org.get(verdict.tenantId) ?? 0) + 1,
    );
  } else if (verdict.scope === AgentLessonScope.COURSE && verdict.trackId) {
    counts.course.set(
      verdict.trackId,
      (counts.course.get(verdict.trackId) ?? 0) + 1,
    );
  } else {
    counts.platform++;
  }
}

/**
 * The candidate's bundle: the GA bundle with retired lessons dropped, the
 * accepted lessons added to the playbook (platform ones also frozen into
 * `lessonSnapshot`, which S1 shows), and each tweak applied. A tweaked
 * prompt's version is bumped so traces say which text ran.
 */
export function buildCandidateBundle(
  ga: GuideReleaseBundle,
  input: {
    playbook: GuidePlaybookLesson[];
    retiredIds: Set<string>;
    accepted: Array<{ verdict: ChangeVerdict; lessonId: string }>;
  },
): GuideReleaseBundle {
  const playbook = input.playbook.filter((l) => !input.retiredIds.has(l.id));
  const policyValues: Record<string, PolicyValue> = {};
  const prompts = structuredClone(ga.prompts);
  for (const { verdict, lessonId } of input.accepted) {
    const { change } = verdict;
    if (change.kind === 'lesson') {
      playbook.push({
        id: lessonId,
        scope: verdict.scope,
        tenantId: verdict.tenantId,
        trackId: verdict.trackId,
        text: change.text.trim(),
      });
    } else if (change.kind === 'policy') {
      policyValues[change.policy!.key] = change.policy!.value;
    } else {
      const role = change.prompt!.role as GuideRole;
      const current = prompts[role]!;
      prompts[role] = {
        ...current,
        version: current.version + 1,
        text: current.text.replace(change.prompt!.find, change.prompt!.replace),
      };
    }
  }
  return {
    ...ga,
    prompts,
    policy: applyPolicyValues(ga.policy, policyValues),
    playbook,
    lessonSnapshot: playbook
      .filter((l) => l.scope === 'platform')
      .map((l) => l.text),
  };
}

/**
 * The GA's playbook with ids. A release from before the curator has only
 * `lessonSnapshot`; its lines become platform lessons with stable ids.
 */
export function currentPlaybook(
  bundle: GuideReleaseBundle,
): GuidePlaybookLesson[] {
  if (bundle.playbook) return bundle.playbook.map((l) => ({ ...l }));
  return (bundle.lessonSnapshot ?? []).map((text, i) => ({
    id: `snapshot-${i}`,
    scope: 'platform' as const,
    text,
  }));
}
