import { ROLEPLAY_DESIGN_MODES } from 'src/learn/util/roleplay-design.util';
import { RoleplayInterviewBrief } from '../type/roleplay-interview.type';

/**
 * The roleplay interview's stages, in code (Course Pilot phase 5, ROLEPLAY_PILOT_STAGES): the
 * same design as Course Pilot's stage machine (src/course-copilot/util/course-pilot-stages.util.ts).
 * The interview order used to live only in the prompt, with code checking five fields when the
 * plan was proposed, so the agent could skip ahead, loop or over-ask.
 *
 * The stage is DERIVED from the brief — the first stage whose exit check fails — so changing an
 * earlier answer puts the interview back in that stage. Each stage has a question limit; the
 * plan tool exists only once the brief can carry a plan. No state is stored: questions are
 * tagged with the stage they were asked in, and counted from the transcript.
 */

export type RoleplayPilotStageId =
  | 'learners'
  | 'skill'
  | 'client'
  | 'practice'
  | 'plan';

export interface RoleplayPilotStage {
  id: RoleplayPilotStageId;
  title: string;
  /** What the agent works on here, as it reads it. */
  goal: string;
  /** Questions allowed in this stage; null = no limit. */
  questions: number | null;
  /** Whether propose_plan is on the belt. */
  canPlan: boolean;
}

/** The whole interview's question limit, across stages. */
export const ROLEPLAY_PILOT_MAX_QUESTIONS = 8;

export const ROLEPLAY_PILOT_STAGES: readonly RoleplayPilotStage[] = [
  {
    id: 'learners',
    title: 'Learners and goal',
    goal:
      'Who the learners are (role, experience) and what they should be able to do after this ' +
      'roleplay, in one sentence. A learner profile from the library can fill who they are.',
    questions: 2,
    canPlan: false,
  },
  {
    id: 'skill',
    title: 'Competency and mode',
    goal:
      'The competency it practises, picked from the library (list_competencies), and the mode: ' +
      'learning (guided, supports on), practice (realistic, some support) or performance ' +
      '(assessed, no support). When the trainer\'s words already name the mode ("practice", ' +
      '"assessment"/"assessed"/"test" = performance, "guided"/"teach" = learning), record it ' +
      'with update_brief instead of asking.',
    questions: 2,
    canPlan: false,
  },
  {
    id: 'client',
    title: 'The client',
    goal:
      'Who the learner talks to, in a sentence or two (age, situation, what they hide or want). ' +
      'Search the Character Library with that description; when it finds characters who could ' +
      'play the client, the trainer chooses one of them or a new character.',
    questions: 2,
    canPlan: false,
  },
  {
    id: 'practice',
    title: 'Practice details',
    goal:
      'Difficulty, language, what helpful and unhelpful responses look like, the pass mark and ' +
      'length. Defaults, recorded with update_brief and named in your reply rather than asked: ' +
      'the language the trainer writes in unless they named another; difficulty from their ' +
      'words, else MEDIUM; behaviours from the competency. Ask only what they care about and ' +
      'you cannot infer, then propose the plan.',
    questions: 3,
    canPlan: true,
  },
  {
    id: 'plan',
    title: 'The plan',
    goal:
      'The plan is on the right for the trainer to approve. When they ask for a change, record ' +
      'it and propose the plan again.',
    questions: null,
    canPlan: true,
  },
];

const BY_ID = new Map(ROLEPLAY_PILOT_STAGES.map((stage) => [stage.id, stage]));

export function roleplayPilotStage(
  id: RoleplayPilotStageId,
): RoleplayPilotStage {
  return BY_ID.get(id)!;
}

export function isRoleplayPilotStageId(
  value: unknown,
): value is RoleplayPilotStageId {
  return typeof value === 'string' && BY_ID.has(value as RoleplayPilotStageId);
}

export interface RoleplayPilotPosition {
  stage: RoleplayPilotStage;
  /** 1-based, of `steps`. */
  step: number;
  steps: number;
  /** What the current stage still needs, in words. */
  missing: string[];
  /** Questions already asked in this stage, and in the whole interview. */
  askedHere: number;
  totalAsked: number;
  /** Left in this stage (capped by the interview's limit); Infinity when unlimited. */
  questionsLeft: number;
}

const filled = (text: unknown) =>
  typeof text === 'string' && text.trim().length > 0;

/** What each gated stage still needs; empty = its exit check passes. */
function missingFor(
  id: RoleplayPilotStageId,
  brief: RoleplayInterviewBrief,
  clientChosen: boolean,
): string[] {
  const missing: string[] = [];
  switch (id) {
    case 'learners':
      if (!filled(brief.learners?.who)) missing.push('who the learners are');
      if (!filled(brief.goal))
        missing.push('what the learner should be able to do');
      break;
    case 'skill': {
      const ids = brief.competencyIds ?? [];
      const names = brief.competencyNames ?? [];
      if (!ids.length || names.length !== ids.length) {
        missing.push('a competency from the library');
      }
      if (!brief.mode || !ROLEPLAY_DESIGN_MODES.includes(brief.mode)) {
        missing.push('the mode');
      }
      break;
    }
    case 'client':
      if (!filled(brief.client?.description) && !brief.client?.characterId) {
        missing.push('the client');
      } else if (!clientChosen) {
        missing.push(
          'the Character Library searched, and the trainer’s choice when it found matches',
        );
      }
      break;
    case 'practice':
      // Defaults are fine, but they must be in the brief before a plan: a plan without them
      // left difficulty and pass mark unset in half the eval runs.
      if (!brief.difficulty) missing.push('the difficulty');
      if (!brief.languages?.length) missing.push('the language');
      if (typeof brief.minScore !== 'number') missing.push('the pass mark');
      break;
    default:
      break;
  }
  return missing;
}

/** The stage each question field belongs to: a card for a later stage waits for that stage. */
export const ROLEPLAY_FIELD_STAGE: Record<string, RoleplayPilotStageId> = {
  learnerProfileId: 'learners',
  competencyIds: 'skill',
  mode: 'skill',
  characterId: 'client',
  difficulty: 'practice',
  languageIds: 'practice',
  minScore: 'practice',
  lengthMinutes: 'practice',
};

const STAGE_ORDER: RoleplayPilotStageId[] = [
  'learners',
  'skill',
  'client',
  'practice',
  'plan',
];

/** Why a card for this field is refused now, or null. Earlier stages' fields stay allowed. */
export function fieldStageRefusal(
  position: RoleplayPilotPosition,
  field: unknown,
): string | null {
  const belongs =
    typeof field === 'string' ? ROLEPLAY_FIELD_STAGE[field] : undefined;
  if (!belongs) return null;
  if (STAGE_ORDER.indexOf(belongs) <= STAGE_ORDER.indexOf(position.stage.id)) {
    return null;
  }
  return (
    `Not asked: ${field} belongs to "${roleplayPilotStage(belongs).title}", and the interview ` +
    `is at "${position.stage.title}", which still needs ${position.missing.join('; ') || 'nothing'}. ` +
    'Ask about that first.'
  );
}

/** Why propose_plan is refused now, or null. */
export function planRefusal(position: RoleplayPilotPosition): string | null {
  if (!position.stage.canPlan) {
    return (
      `Not proposed: the interview is at "${position.stage.title}", which still needs ` +
      `${position.missing.join('; ')}.`
    );
  }
  if (position.stage.id === 'practice' && position.missing.length) {
    return (
      `Not proposed: record ${position.missing.join(', ')} first, with update_brief. Use ` +
      'sensible defaults where the trainer has no view (difficulty MEDIUM unless their words ' +
      'say otherwise, the language they write in, a pass mark of 60), and name the defaults in ' +
      'your reply so they can change them.'
    );
  }
  return null;
}

/**
 * Where the interview is. `clientChosen` is the plan's character rule
 * (characterChoiceProblem(brief) === null); `hasPlan` whether a plan was proposed; `asked`
 * how many questions each stage has asked so far.
 */
export function resolveRoleplayPilotStage(
  brief: RoleplayInterviewBrief | null | undefined,
  opts: {
    clientChosen: boolean;
    hasPlan: boolean;
    asked: Partial<Record<RoleplayPilotStageId, number>>;
  },
): RoleplayPilotPosition {
  const b = brief ?? {};
  let stage = roleplayPilotStage(opts.hasPlan ? 'plan' : 'practice');
  let missing: string[] = [];
  let earlierOpen = false;
  for (const id of ['learners', 'skill', 'client'] as const) {
    const gaps = missingFor(id, b, opts.clientChosen);
    if (gaps.length) {
      stage = roleplayPilotStage(id);
      missing = gaps;
      earlierOpen = true;
      break;
    }
  }
  if (!earlierOpen && stage.id === 'practice') {
    missing = missingFor('practice', b, opts.clientChosen);
  }
  const askedHere = opts.asked[stage.id] ?? 0;
  const totalAsked = Object.values(opts.asked).reduce(
    (sum, n) => sum + (n ?? 0),
    0,
  );
  const questionsLeft =
    stage.questions === null
      ? Infinity
      : Math.max(
          0,
          Math.min(
            stage.questions - askedHere,
            ROLEPLAY_PILOT_MAX_QUESTIONS - totalAsked,
          ),
        );
  return {
    stage,
    step: ROLEPLAY_PILOT_STAGES.indexOf(stage) + 1,
    steps: ROLEPLAY_PILOT_STAGES.length,
    missing,
    askedHere,
    totalAsked,
    questionsLeft,
  };
}

/** Questions per stage, from the transcript's question cards (each tagged with its stage). */
export function countStageQuestions(
  messages: { metadata?: Record<string, any> | null }[],
): Partial<Record<RoleplayPilotStageId, number>> {
  const out: Partial<Record<RoleplayPilotStageId, number>> = {};
  for (const message of messages) {
    for (const question of message.metadata?.questions ?? []) {
      const stage: unknown = question?.stage;
      if (isRoleplayPilotStageId(stage)) out[stage] = (out[stage] ?? 0) + 1;
    }
  }
  return out;
}

/** Why ask_trainer is refused here, or null when a question is allowed. */
export function roleplayQuestionRefusal(
  position: RoleplayPilotPosition,
): string | null {
  if (position.questionsLeft > 0) return null;
  const where =
    position.totalAsked >= ROLEPLAY_PILOT_MAX_QUESTIONS
      ? `the interview's ${ROLEPLAY_PILOT_MAX_QUESTIONS}-question limit`
      : `the ${position.stage.questions}-question limit for "${position.stage.title}"`;
  return (
    `No more questions: you have reached ${where}. Fill what is still missing ` +
    `(${position.missing.join('; ') || 'nothing required'}) with sensible defaults from what ` +
    'the trainer already said, using update_brief, and say in your reply which defaults you ' +
    'chose so the trainer can change them. Your reply must not ask the trainer anything: a ' +
    'question without a card cannot be answered.'
  );
}

/** The stage block on the newest user turn. */
export function renderRoleplayPilotStage(
  position: RoleplayPilotPosition,
): string {
  const { stage, step, steps, missing, questionsLeft } = position;
  const left = Number.isFinite(questionsLeft) ? String(questionsLeft) : 'any';
  return [
    `<roleplay_stage id="${stage.id}" step="${step} of ${steps}" questions_left="${left}">`,
    `Stage: ${stage.title}. ${stage.goal}`,
    missing.length
      ? `Still needed before ${stage.id === 'practice' ? 'the plan' : 'the next stage'}: ${missing.join('; ')}.`
      : '',
    stage.canPlan
      ? ''
      : 'propose_plan is not available yet: it opens once the learners, competency, mode and client are settled.',
    'Work only on this stage: it moves on by itself once these are in the brief. Record what ' +
      'the trainer already said with update_brief before asking anything, and never ask what ' +
      'the brief already holds.',
    '</roleplay_stage>',
  ]
    .filter(Boolean)
    .join('\n');
}
