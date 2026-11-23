import { v4 as uuidv4 } from 'uuid';
import {
  roleplaySettingsForMode,
  ROLEPLAY_DESIGN_MODES,
  RoleplayDesignMode,
} from 'src/learn/util/roleplay-design.util';
import {
  ROLEPLAY_INTERVIEW_DIFFICULTIES,
  RoleplayInterviewBrief,
  RoleplayInterviewGeneration,
  RoleplayInterviewPlan,
  RoleplayInterviewQuestion,
  RoleplayInterviewQuestionOption,
} from '../type/roleplay-interview.type';
import {
  ROLEPLAY_INTERVIEW_BRIEF_LIMITS,
  ROLEPLAY_INTERVIEW_PLAN_LIMITS,
} from '../constants/roleplay-interview.constants';

/**
 * The roleplay interview's brief and plan, as pure functions: what is still
 * needed, how a model's patch is shaped and checked (the library lookups the
 * patch needs are the tools service's), how a proposed plan is validated and
 * what approval hands the frontend.
 */

const text = (value: unknown, max: number): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const flat = value.trim();
  if (!flat) return undefined;
  return flat.length > max ? flat.slice(0, max) : flat;
};

const textList = (value: unknown, maxItems: number, maxChars: number) =>
  Array.isArray(value)
    ? [
        ...new Set(
          value
            .map((entry) => text(entry, maxChars))
            .filter((entry): entry is string => Boolean(entry)),
        ),
      ].slice(0, maxItems)
    : [];

/** Human labels for the REQUIRED brief fields that are still missing. */
export function stillNeeded(brief: RoleplayInterviewBrief | null | undefined) {
  const b = brief ?? {};
  const missing: string[] = [];
  if (!b.learners?.who?.trim()) missing.push('who the learners are');
  if (!b.goal?.trim()) missing.push('what the learner should be able to do');
  // A competency counts only once the server has named it from the library.
  const ids = b.competencyIds ?? [];
  const names = b.competencyNames ?? [];
  if (!ids.length || names.length !== ids.length) missing.push('a competency');
  if (!b.mode || !ROLEPLAY_DESIGN_MODES.includes(b.mode)) {
    missing.push('the mode');
  }
  if (!b.client?.description?.trim() && !b.client?.characterId) {
    missing.push('the client');
  }
  return missing;
}

/** Brief keys update_brief accepts. Anything else is reported back as ignored. */
export const BRIEF_PATCH_KEYS = [
  'learners',
  'learnerProfileId',
  'goal',
  'competencyIds',
  'mode',
  'difficulty',
  'client',
  'setting',
  'languages',
  'behaviours',
  'triggerWarningIds',
  'minScore',
  'lengthMinutes',
  'notes',
] as const;

/**
 * What a patch asks for, shaped but not yet checked against the library:
 * ids the tools service must resolve, and plain fields already final. `null`
 * on a field clears it. `notes` appends.
 */
export interface ShapedBriefPatch {
  fields: Partial<RoleplayInterviewBrief>;
  clear: Set<keyof RoleplayInterviewBrief>;
  competencyIds?: string[];
  learnerProfileId?: string;
  characterId?: string | null;
  languageIds?: string[];
  triggerWarningIds?: string[];
  errors: string[];
  ignoredKeys: string[];
}

export function shapeBriefPatch(
  input: Record<string, any>,
  current: RoleplayInterviewBrief,
): ShapedBriefPatch {
  const limits = ROLEPLAY_INTERVIEW_BRIEF_LIMITS;
  const out: ShapedBriefPatch = {
    fields: {},
    clear: new Set(),
    errors: [],
    ignoredKeys: [],
  };
  const patch = input ?? {};
  for (const key of Object.keys(patch)) {
    if (!(BRIEF_PATCH_KEYS as readonly string[]).includes(key)) {
      out.ignoredKeys.push(key);
    }
  }
  const has = (key: string) => Object.prototype.hasOwnProperty.call(patch, key);
  const isNull = (key: string) => has(key) && patch[key] === null;

  if (has('learners')) {
    if (isNull('learners')) out.clear.add('learners');
    else {
      const who = text(patch.learners?.who, limits.shortText);
      const prior = text(patch.learners?.priorExperience, limits.shortText);
      const merged = {
        who: who ?? current.learners?.who ?? '',
        ...((prior ?? current.learners?.priorExperience)
          ? { priorExperience: prior ?? current.learners?.priorExperience }
          : {}),
      };
      if (!merged.who)
        out.errors.push('learners.who must be a short description');
      else out.fields.learners = merged;
    }
  }
  if (has('learnerProfileId')) {
    if (isNull('learnerProfileId')) {
      out.clear.add('learnerProfileId');
      out.clear.add('learnerProfileName');
    } else out.learnerProfileId = String(patch.learnerProfileId ?? '').trim();
  }
  if (has('goal')) {
    if (isNull('goal')) out.clear.add('goal');
    else {
      const goal = text(patch.goal, limits.longText);
      if (goal) out.fields.goal = goal;
      else out.errors.push('goal must be a sentence');
    }
  }
  if (has('competencyIds')) {
    const ids = textList(patch.competencyIds, limits.maxCompetencies + 1, 64);
    if (ids.length > limits.maxCompetencies) {
      out.errors.push(`at most ${limits.maxCompetencies} competencies`);
    } else if (!ids.length) {
      out.clear.add('competencyIds');
      out.clear.add('competencyNames');
    } else out.competencyIds = ids;
  }
  if (has('mode')) {
    if (isNull('mode')) out.clear.add('mode');
    else if (ROLEPLAY_DESIGN_MODES.includes(patch.mode)) {
      out.fields.mode = patch.mode as RoleplayDesignMode;
    } else {
      out.errors.push(
        `mode must be one of ${ROLEPLAY_DESIGN_MODES.join(', ')}`,
      );
    }
  }
  if (has('difficulty')) {
    const value = String(patch.difficulty ?? '').toUpperCase();
    if (isNull('difficulty')) out.clear.add('difficulty');
    else if (
      (ROLEPLAY_INTERVIEW_DIFFICULTIES as readonly string[]).includes(value)
    ) {
      out.fields.difficulty = value as RoleplayInterviewBrief['difficulty'];
    } else out.errors.push('difficulty must be EASY, MEDIUM or HARD');
  }
  if (has('client')) {
    if (isNull('client')) out.clear.add('client');
    else {
      // A bare string is read as the client's description.
      const raw: Record<string, any> =
        typeof patch.client === 'object' && patch.client
          ? patch.client
          : { description: patch.client };
      const description =
        'description' in raw
          ? raw.description === null
            ? undefined
            : text(raw.description, limits.longText)
          : current.client?.description;
      out.fields.client = {
        ...(description ? { description } : {}),
      };
      if ('characterId' in raw) {
        out.characterId =
          raw.characterId === null
            ? null
            : String(raw.characterId ?? '').trim() || null;
      } else if (current.client?.characterId) {
        out.fields.client.characterId = current.client.characterId;
        out.fields.client.characterName = current.client.characterName;
      }
    }
  }
  if (has('setting')) {
    if (isNull('setting')) out.clear.add('setting');
    else {
      const setting = text(patch.setting, limits.longText);
      if (setting) out.fields.setting = setting;
    }
  }
  if (has('languages')) {
    const ids = (Array.isArray(patch.languages) ? patch.languages : [])
      .map((entry: any) =>
        String(
          entry && typeof entry === 'object'
            ? (entry.languageId ?? entry.code ?? '')
            : (entry ?? ''),
        ).trim(),
      )
      .filter(Boolean);
    if (ids.length > limits.maxLanguages) {
      out.errors.push(`at most ${limits.maxLanguages} languages`);
    } else if (!ids.length) out.clear.add('languages');
    else out.languageIds = [...new Set<string>(ids)];
  }
  if (has('behaviours')) {
    if (isNull('behaviours')) out.clear.add('behaviours');
    else {
      out.fields.behaviours = {
        helpful:
          patch.behaviours && 'helpful' in patch.behaviours
            ? textList(
                patch.behaviours.helpful,
                limits.maxBehaviours,
                limits.shortText,
              )
            : (current.behaviours?.helpful ?? []),
        unhelpful:
          patch.behaviours && 'unhelpful' in patch.behaviours
            ? textList(
                patch.behaviours.unhelpful,
                limits.maxBehaviours,
                limits.shortText,
              )
            : (current.behaviours?.unhelpful ?? []),
      };
    }
  }
  if (has('triggerWarningIds')) {
    const ids = textList(patch.triggerWarningIds, 20, 64);
    if (!ids.length) out.clear.add('triggerWarningIds');
    else out.triggerWarningIds = ids;
  }
  if (has('minScore')) {
    const score = Number(patch.minScore);
    if (isNull('minScore')) out.clear.add('minScore');
    else if (Number.isFinite(score) && score > 0 && score <= 10) {
      // A 4 or a 7 is a mark out of 10: as a percentage it would pass almost anyone.
      out.errors.push(
        `minScore is a percentage out of 100 (e.g. 60), not out of 10: ${score} would pass almost every attempt`,
      );
    } else if (Number.isFinite(score) && score >= 0 && score <= 100) {
      out.fields.minScore = Math.round(score);
    } else out.errors.push('minScore must be a number from 0 to 100');
  }
  if (has('lengthMinutes')) {
    const minutes = Number(patch.lengthMinutes);
    if (isNull('lengthMinutes')) out.clear.add('lengthMinutes');
    else if (
      Number.isFinite(minutes) &&
      minutes >= 1 &&
      minutes <= limits.maxLengthMinutes
    ) {
      out.fields.lengthMinutes = Math.round(minutes);
    } else {
      out.errors.push(`lengthMinutes must be 1 to ${limits.maxLengthMinutes}`);
    }
  }
  if (has('notes')) {
    const added = textList(patch.notes, limits.maxNotes, limits.longText);
    out.fields.notes = [...new Set([...(current.notes ?? []), ...added])].slice(
      -limits.maxNotes,
    );
  }
  return out;
}

/** Apply a resolved patch: plain fields replace, cleared keys go. */
export function applyBriefPatch(
  current: RoleplayInterviewBrief,
  fields: Partial<RoleplayInterviewBrief>,
  clear: Set<keyof RoleplayInterviewBrief>,
): RoleplayInterviewBrief {
  const next: RoleplayInterviewBrief = { ...current, ...fields };
  for (const key of clear) delete next[key];
  if (next.client && !next.client.description && !next.client.characterId) {
    delete next.client;
  }
  return next;
}

// ── Plan ────────────────────────────────────────────────────────────────────

/** Validate a proposed plan; on success the plan with server-set fields. */
export function validatePlan(
  input: Record<string, any>,
  brief: RoleplayInterviewBrief,
  version: number,
): { ok: true; plan: RoleplayInterviewPlan } | { ok: false; errors: string[] } {
  const limits = ROLEPLAY_INTERVIEW_PLAN_LIMITS;
  const errors: string[] = [];
  const long = ROLEPLAY_INTERVIEW_BRIEF_LIMITS.longText;
  const need = (value: unknown, path: string, max = long) => {
    const value_ = text(value, max);
    if (!value_) errors.push(`${path} is required`);
    return value_ ?? '';
  };
  const title = need(input?.title, 'title', 120);
  const sheet = input?.characterSheet ?? {};
  const characterSheet = {
    // A library character keeps its library name.
    name:
      brief.client?.characterName ??
      oneName(need(sheet.name, 'characterSheet.name', 120), errors),
    summary: need(sheet.summary, 'characterSheet.summary'),
    hides: need(sheet.hides, 'characterSheet.hides'),
    opensUpWhen: need(sheet.opensUpWhen, 'characterSheet.opensUpWhen'),
    speaks: need(sheet.speaks, 'characterSheet.speaks'),
  };
  const moments = textList(input?.moments, limits.maxMoments + 1, long);
  if (
    moments.length < limits.minMoments ||
    moments.length > limits.maxMoments
  ) {
    errors.push(
      `moments needs ${limits.minMoments}-${limits.maxMoments} entries`,
    );
  }
  const states = (Array.isArray(input?.states) ? input.states : [])
    .map((state: any) => ({
      name: text(state?.name, 80) ?? '',
      guidelines: text(state?.guidelines, long) ?? '',
    }))
    .filter(
      (state: { name: string; guidelines: string }) =>
        state.name || state.guidelines,
    );
  if (states.length < limits.minStates || states.length > limits.maxStates) {
    errors.push(`states needs ${limits.minStates}-${limits.maxStates} entries`);
  }
  states.forEach(
    (state: { name: string; guidelines: string }, index: number) => {
      if (!state.name || !state.guidelines) {
        errors.push(`states[${index}] needs a name and guidelines`);
      }
    },
  );
  const criteria = input?.passCriteria ?? {};
  const helpful = textList(criteria.helpful, limits.maxBehaviours, 300);
  const unhelpful = textList(criteria.unhelpful, limits.maxBehaviours, 300);
  if (!helpful.length)
    errors.push('passCriteria.helpful needs at least one behaviour');
  if (!unhelpful.length)
    errors.push('passCriteria.unhelpful needs at least one behaviour');
  const rawScore = criteria.minScore ?? brief.minScore;
  const minScore =
    rawScore === undefined || rawScore === null
      ? limits.defaultMinScore
      : Number(rawScore);
  if (!Number.isFinite(minScore) || minScore < 0 || minScore > 100) {
    errors.push('passCriteria.minScore must be 0 to 100');
  } else if (minScore > 0 && minScore <= 10) {
    errors.push(
      'passCriteria.minScore is a percentage out of 100 (e.g. 60), not out of 10',
    );
  }
  moments.forEach((moment, index) => {
    if (/^(practi[sc]es?|skills?|goal|learners?)\b\s*:/i.test(moment)) {
      errors.push(
        `moments[${index}] is a summary, not a moment: a moment is something the client says or does in the conversation`,
      );
    }
  });
  const openingLine = need(input?.openingLine, 'openingLine', 500);
  if (!brief.mode) errors.push('the brief has no mode');
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    plan: {
      version,
      title,
      characterSheet,
      moments,
      states,
      passCriteria: { helpful, unhelpful, minScore: Math.round(minScore) },
      openingLine,
      supports: roleplaySettingsForMode(brief.mode!, null),
    },
  };
}

/** What approval hands the frontend generation pipeline. */
export function composeGeneration(
  brief: RoleplayInterviewBrief,
  plan: RoleplayInterviewPlan,
): RoleplayInterviewGeneration {
  const sheet = plan.characterSheet;
  const lines: string[] = [];
  if (brief.client?.description) lines.push(brief.client.description);
  if (brief.client?.characterId) {
    lines.push(
      `Played by the Character Library character ${
        brief.client.characterName ?? sheet.name
      }.`,
    );
  }
  if (brief.setting) lines.push(`Setting: ${brief.setting}`);
  lines.push(
    `Character: ${sheet.name} — ${sheet.summary}`,
    `What they hide: ${sheet.hides}`,
    `Opens up when: ${sheet.opensUpWhen}`,
    `How they speak: ${sheet.speaks}`,
    'Moments the character must create:',
    ...plan.moments.map((moment) => `- ${moment}`),
    `Opening line: "${plan.openingLine}"`,
  );
  if (brief.notes?.length) {
    lines.push('Trainer notes:', ...brief.notes.map((note) => `- ${note}`));
  }
  const agentTestCases = [
    'Helpful behaviours:',
    ...plan.passCriteria.helpful.map((b) => `- ${b}`),
    '',
    'Unhelpful behaviours:',
    ...plan.passCriteria.unhelpful.map((b) => `- ${b}`),
  ].join('\n');
  const competencyIds = brief.competencyIds ?? [];
  return {
    actorDescription: lines.join('\n'),
    competencyId: competencyIds[0],
    competencyIds,
    competencyName: brief.competencyNames?.[0] ?? '',
    mode: brief.mode!,
    ...(brief.difficulty ? { difficulty: brief.difficulty } : {}),
    ...(brief.client?.characterId
      ? { characterId: brief.client.characterId }
      : {}),
    ...(brief.languages?.length ? { languages: brief.languages } : {}),
    agentTestCases,
    minScore: plan.passCriteria.minScore,
    ...(brief.lengthMinutes ? { lengthMinutes: brief.lengthMinutes } : {}),
    ...(brief.triggerWarningIds?.length
      ? { triggerWarningIds: brief.triggerWarningIds }
      : {}),
    states: plan.states,
  };
}

// ── Question cards (Course Copilot's normalisation) ─────────────────────────

const SELECT_KINDS = ['singleSelect', 'multiSelect', 'dropdown'];

export function buildQuestion(
  input: Record<string, any>,
): RoleplayInterviewQuestion {
  let kind = String(input?.kind ?? 'singleSelect');
  if (![...SELECT_KINDS, 'freeText'].includes(kind)) kind = 'singleSelect';
  const isSelect = SELECT_KINDS.includes(kind);
  const options = isSelect ? normaliseOptions(input?.options) : [];
  return {
    id: uuidv4(),
    prompt: String(input?.prompt ?? '').trim(),
    kind: (isSelect && !options.length
      ? 'freeText'
      : kind) as RoleplayInterviewQuestion['kind'],
    ...(input?.rationale ? { rationale: String(input.rationale) } : {}),
    ...(options.length ? { options } : {}),
    // Every card takes a typed answer.
    allowCustom: true,
    ...(input?.allowNone ? { allowNone: true } : {}),
    ...(typeof input?.minSelections === 'number'
      ? { minSelections: input.minSelections }
      : {}),
    ...(typeof input?.maxSelections === 'number'
      ? { maxSelections: input.maxSelections }
      : {}),
  };
}

export function normaliseOptions(
  raw: unknown,
): RoleplayInterviewQuestionOption[] {
  if (!Array.isArray(raw)) return [];
  const options = raw
    .map((option) => {
      if (typeof option === 'string') {
        const value = option.trim();
        return value ? { id: value, label: value } : null;
      }
      if (option && typeof option === 'object') {
        const source = option as Record<string, any>;
        const id = String(source.id ?? source.label ?? '').trim();
        const label = String(source.label ?? source.id ?? '').trim();
        if (!id || !label) return null;
        return {
          id,
          label,
          ...(source.description
            ? { description: String(source.description) }
            : {}),
          ...(source.recommended ? { recommended: true } : {}),
        };
      }
      return null;
    })
    .filter(Boolean) as RoleplayInterviewQuestionOption[];
  const seenIds = new Set<string>();
  const unique = options.filter((option) =>
    seenIds.has(option.id) ? false : (seenIds.add(option.id), true),
  );
  let seen = false;
  for (const option of unique) {
    if (!option.recommended) continue;
    if (seen) delete option.recommended;
    else seen = true;
  }
  return unique;
}

/**
 * One clear person per roleplay: "Anita / Adit" or "Anita or Adit" leaves the voice, the
 * pronouns and every generated field to guess. The name is kept; the error asks for one.
 */
function oneName(name: string, errors: string[]): string {
  if (name && /\s\/\s|\s+or\s+|\(.*(flexible|either).*\)/i.test(name)) {
    errors.push(
      `characterSheet.name "${name}" names more than one person: choose one name, one gender and one age`,
    );
  }
  return name;
}
