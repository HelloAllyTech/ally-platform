import { GuideAtmosphere } from '../contract/generated/guide-contract';
import { itemTypeLabel } from '../context/guide-context';
import { GuideMode } from '../enum/guide.enum';
import { asData } from '../prompts/sentinel.prompt';
import { SentinelOverlay } from '../safety/sentinel';
import { CourseSpine, SpineItem } from './course-spine';
import {
  FirstWinPlan,
  GuidanceDial,
  ProseBudget,
  SteerDecision,
} from './pacing';

/**
 * The situation report (plans/ally-guide/plan.md §7.6, §7.8): the Conductor's
 * decisions for one turn, handed to the orchestrator as a mid-conversation
 * system message after the learner's message. It is the ONLY place the model
 * learns item states, the steer level, its word budget and the mode, so the
 * cached spans above it never change within an epoch.
 *
 * Written as short imperative lines, not data: the model acts on it, and a
 * reviewer reading a trace should see exactly what Ally was told.
 */

export interface SituationInput {
  turn: number;
  mode: GuideMode;
  atmosphere: GuideAtmosphere;
  channel: 'text' | 'voice';
  guidance: GuidanceDial;
  budget: ProseBudget;
  steer: SteerDecision;
  spine: CourseSpine;
  firstWin: FirstWinPlan;
  releaseWindowOpen: boolean;
  overlay: SentinelOverlay;
  /** Short facts about what happened since the last turn. */
  events: string[];
  /** An item open on the learner's screen right now. */
  openItem?: Pick<SpineItem, 'id' | 'title' | 'type'> | null;
  /** A quiz is open: only point to material (plan §6.4). */
  quizOpen?: boolean;
  /** The next step's card is already in view (presented this epoch, unfinished). */
  nextOnScreen?: boolean;
  /** The platform started this turn (a completion, a grade), not the learner. */
  platformTurn?: boolean;
  /** The learner pressed Start or Continue: they asked for the next step. */
  continuePressed?: boolean;
}

const GUIDANCE_LABEL: Record<GuidanceDial, string> = {
  lead: 'lead me',
  walk: 'walk with me',
  drive: "I'll drive",
};

const STEER_LINE: Record<number, string> = {
  0: 'Do not mention the course or the next step. Listen and follow the learner.',
  1: 'Answer the learner. Do not steer back to the course unless they ask.',
  2: 'You may end with ONE short, gentle offer to continue with the next step.',
  3: 'You may present the next item if it fits the moment.',
};

const describe = (item: SpineItem): string =>
  `"${asData(item.title)}" (${itemTypeLabel(item.type)}, ~${item.estimatedMinutes} min${
    item.boss ? ', practice' : ''
  }) id ${item.id}`;

export function renderSituationReport(input: SituationInput): string {
  const { spine, steer, budget } = input;
  const lines: string[] = [];

  lines.push(
    `mode: ${input.mode} · atmosphere: ${input.atmosphere} · channel: ${input.channel}`,
  );
  lines.push(
    `reply budget: at most ${budget.maxWords} words` +
      (budget.maxSentences ? ` and ${budget.maxSentences} sentences` : '') +
      ` (guidance: ${GUIDANCE_LABEL[input.guidance]})`,
  );

  if (input.mode === GuideMode.CARE) {
    lines.push(
      'CARE: the learner is having a hard time. Slow down, follow their lead, ' +
        'no steering, no praise of progress. Offer show_wellbeing_resources if it would help.',
    );
  } else if (input.mode === GuideMode.CRISIS_FOLLOWUP) {
    lines.push(
      'This week follows a crisis. Be gentle and unhurried. Do not push activities; ' +
        'the learner decides when to go on.',
    );
  }

  if (input.overlay === 'real_case') {
    lines.push(
      'REAL CASE: the learner is asking about a real person they support. ' +
        'Talk about principles and their own response only; point them to ' +
        'their supervisor and protocol; ask them to leave out identifying details.',
    );
  } else if (input.overlay === 'pii') {
    lines.push(
      'IDENTIFYING DETAILS: the message names or identifies a real third party. ' +
        'Gently ask them to leave out names and details, and do not repeat them.',
    );
  }

  if (input.platformTurn) {
    lines.push(
      'This turn was started by the platform, not by a new message from the learner. ' +
        'Respond to the <platform_event> lines in the latest message: acknowledge what ' +
        'they just did, specifically, in a sentence or two. Do not answer earlier ' +
        'messages again. Acknowledging it is fine at any steer level' +
        (input.mode === GuideMode.CARE
          ? ' — keep it quiet and factual in CARE'
          : '') +
        '; the steer level still decides whether you mention the next step.',
    );
  }

  lines.push(
    `steer: level ${steer.level} (${steer.reason}). ${STEER_LINE[steer.level]}`,
  );

  if (input.quizOpen) {
    lines.push(
      'A quiz is open: only point to where the material is covered. Never hint at answers.',
    );
  } else if (input.openItem) {
    lines.push(
      `Open on screen: "${asData(input.openItem.title)}" (${itemTypeLabel(input.openItem.type)}).`,
    );
  }

  if (input.releaseWindowOpen) {
    lines.push(
      'Release window: they just finished something hard. Listen; do not move on. ' +
        'Call mark_reflection_done once they have reflected.',
    );
  }

  if (!spine.enrolled) {
    lines.push('The learner is not enrolled yet; nothing can be presented.');
  } else if (spine.finished) {
    lines.push(
      `The learner has finished the course (${spine.total} of ${spine.total}). ` +
        'Completed items can be reopened if they ask.',
    );
  } else {
    lines.push(`progress: ${spine.completed} of ${spine.total} complete.`);
    if (spine.current) {
      lines.push(
        `next step: ${describe(spine.current)}` +
          (input.nextOnScreen
            ? ' — its card is already on screen; if they want to go on, point to it, do not present it again.'
            : '.'),
      );
    }
    if (spine.upcoming) lines.push(`after that: ${describe(spine.upcoming)}.`);
  }

  if (input.firstWin.kind === 'item') {
    lines.push(
      'First win: their next step is short. Help them start it; it is their first win.',
    );
  } else if (input.firstWin.kind === 'warm_up') {
    lines.push(
      input.firstWin.reason === 'boss_first'
        ? 'First win: the first activity is a practice conversation. Before it, ' +
            'offer to rehearse one opening line with them and give one specific note.'
        : 'First win: the first activity is long. Before it, offer a quick ' +
            'one-question dilemma from the course topic to warm up.',
    );
  }

  if (
    input.continuePressed &&
    steer.mayPresentNext &&
    !input.nextOnScreen &&
    !input.openItem &&
    spine.current &&
    !spine.finished
  ) {
    lines.push(
      'They pressed Continue: present the next step now with present_course_item, ' +
        'then frame it in a sentence.',
    );
  }

  const presentable = steer.mayPresentNext
    ? 'present_course_item: allowed for the next step (reason next_step); completed items may be reopened.'
    : input.mode === GuideMode.CRISIS
      ? 'present_course_item: not allowed.'
      : 'present_course_item: only if the learner asks (reason learner_asked); completed items may be reopened.';
  lines.push(presentable);

  for (const event of input.events) lines.push(`happened: ${event}`);

  return [
    `<situation_report turn="${input.turn}">`,
    ...lines,
    '</situation_report>',
  ].join('\n');
}
