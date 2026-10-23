import { AgentToolDefinition } from 'src/llm-agent/type/agent-llm.type';
import { CourseSpine, SpineItem } from '../conductor/course-spine';
import { SteerDecision } from '../conductor/pacing';
import { GuideCardPresentation } from '../enum/guide.enum';
import { GuideMode } from '../enum/guide.enum';

/**
 * Ally's v1 tools (plans/ally-guide/plan.md §7.7). Each is strict — the
 * arguments are guaranteed to match the closed schema — because the newest
 * Claude models reject a forced tool choice and strictness is what keeps the
 * schema guarantee. Descriptions follow one shape: what it does, when to use
 * it, one example (Stacks: Tool Description Engineering for Selection
 * Accuracy). Ally has no tool that enrolls, completes, scores or changes the
 * safety mode: those stay with deterministic code.
 */

const NO_ARGS = {
  type: 'object',
  properties: {},
  required: [],
  additionalProperties: false,
} as const;

export const GUIDE_TOOL_NAMES = {
  PRESENT_COURSE_ITEM: 'present_course_item',
  SHOW_COURSE_INFO: 'show_course_info',
  GET_PROGRESS: 'get_progress',
  MARK_REFLECTION_DONE: 'mark_reflection_done',
  SHOW_WELLBEING_RESOURCES: 'show_wellbeing_resources',
  SET_GUIDANCE: 'set_guidance',
  CONSULT_TUTOR: 'consult_tutor',
  REMEMBER: 'remember',
  SAVE_TO_NOTEBOOK: 'save_to_notebook',
  RECORD_NOTICING: 'record_noticing',
  CLOSE_SESSION: 'close_session',
  SUGGEST_SIGN_IN: 'suggest_sign_in',
} as const;

export const GUIDE_TOOLS: AgentToolDefinition[] = [
  {
    name: GUIDE_TOOL_NAMES.PRESENT_COURSE_ITEM,
    description:
      "Show one course activity to the learner as a card they can open. Use it for the learner's next step when the situation report allows presenting, when the learner asks for an activity, or to reopen one they completed. The course order is fixed: locked items are refused. " +
      'Example: {"item_id":"3f2c…","reason":"next_step","framing":"Ten minutes on what to say in the first moments of a call."}',
    input_schema: {
      type: 'object',
      properties: {
        item_id: {
          type: 'string',
          description: 'The item id from the course outline.',
        },
        reason: {
          type: 'string',
          enum: ['next_step', 'learner_asked', 'reopen'],
          description:
            'next_step only when presenting is allowed; learner_asked when they asked for it; reopen for a completed item.',
        },
        framing: {
          type: 'string',
          description:
            'One line shown on the card, in your voice: why this activity, now. At most 140 characters.',
        },
      },
      required: ['item_id', 'reason', 'framing'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: GUIDE_TOOL_NAMES.SHOW_COURSE_INFO,
    description:
      'Open the course overview (what it covers, how long it takes, its chapters) in the side panel. Use when the learner asks what the course is, how long it is, or what is in it. Example: {}',
    input_schema: NO_ARGS,
    strict: true,
  },
  {
    name: GUIDE_TOOL_NAMES.GET_PROGRESS,
    description:
      "Read the learner's progress: completed items, the next step and each chapter's state. Use before answering a question about where they are, if the situation report does not already say. Example: {}",
    input_schema: NO_ARGS,
    strict: true,
  },
  {
    name: GUIDE_TOOL_NAMES.MARK_REFLECTION_DONE,
    description:
      'Record that the learner has reflected on the hard activity they just finished, ending the quiet release window. Use once they have talked it through, never to cut them short. Example: {}',
    input_schema: NO_ARGS,
    strict: true,
  },
  {
    name: GUIDE_TOOL_NAMES.SHOW_WELLBEING_RESOURCES,
    description:
      'Show the learner support resources and helplines from their organisation. Use when they are struggling, ask for support, or the situation report says CARE and it would help. Example: {}',
    input_schema: NO_ARGS,
    strict: true,
  },
  {
    name: GUIDE_TOOL_NAMES.SET_GUIDANCE,
    description:
      'Change how much you guide the learner when they ask you to: "lead" (more guidance and talk), "walk" (balanced, the default), "drive" (they lead; you say very little). Example: {"level":"drive"}',
    input_schema: {
      type: 'object',
      properties: {
        level: { type: 'string', enum: ['lead', 'walk', 'drive'] },
      },
      required: ['level'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: GUIDE_TOOL_NAMES.CONSULT_TUTOR,
    description:
      "Get a grounded answer from the course's own material, with the items it comes from. Use it before answering a question about the course's content, so you never invent what the course says; if the result says not covered, tell the learner the course does not cover it. " +
      'Example: {"question":"What does the course say about sitting with silence?"}',
    input_schema: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: "The question, in the learner's words where possible.",
        },
      },
      required: ['question'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: GUIDE_TOOL_NAMES.REMEMBER,
    description:
      'Remember something about the learner for future conversations: a preference, goal, strength, struggle, context or commitment they shared about THEMSELVES. Never about a client or another person, never anything identifying, and not in a hard moment. The learner can see and delete everything you remember. ' +
      'Example: {"kind":"goal","note":"Wants to feel calmer opening crisis calls."}',
    input_schema: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: [
            'preference',
            'goal',
            'possible_self',
            'strength',
            'struggle',
            'context',
            'commitment',
          ],
        },
        note: {
          type: 'string',
          description: 'One plain sentence, at most 280 characters.',
        },
      },
      required: ['kind', 'note'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: GUIDE_TOOL_NAMES.SAVE_TO_NOTEBOOK,
    description:
      "Save the learner's own words to their notebook: the helper they want to become, a reflection, or a line they practised. The text must be their words, copied from what they wrote, not yours. " +
      'Example: {"kind":"possible_self","text":"Someone people feel safe talking to at 3am."}',
    input_schema: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: ['possible_self', 'reflection', 'rehearsed_line'],
        },
        text: {
          type: 'string',
          description: "The learner's words, copied exactly.",
        },
      },
      required: ['kind', 'text'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: GUIDE_TOOL_NAMES.RECORD_NOTICING,
    description:
      'Save a specific moment you noticed — something the learner did well, with what it led to — to their notebook. Rare: at most twice a session, only for something real you can point to. ' +
      'Example: {"behaviour":"You asked about her plan directly instead of circling it","evidence":"In the roleplay debrief"}',
    input_schema: {
      type: 'object',
      properties: {
        behaviour: {
          type: 'string',
          description: 'What they did, specifically, in one sentence.',
        },
        evidence: {
          type: 'string',
          description: 'Where you saw it, briefly.',
        },
      },
      required: ['behaviour', 'evidence'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: GUIDE_TOOL_NAMES.CLOSE_SESSION,
    description:
      'Show the closing card when the learner is wrapping up for now: one specific thing you noticed today, one thing to watch for next time, and a one-line teaser of what comes next. The card lets them pick when to come back. Use once, when they say they are done for now. ' +
      'Example: {"noticing":"You stayed with Meera\'s silence instead of filling it.","watch_for":"The moment you want to reassure: try reflecting first.","teaser":"Next: a caller who will not say why they called."}',
    input_schema: {
      type: 'object',
      properties: {
        noticing: { type: 'string' },
        watch_for: { type: 'string' },
        teaser: { type: 'string' },
      },
      required: ['noticing', 'watch_for', 'teaser'],
      additionalProperties: false,
    },
    strict: true,
  },
];

/** Where each item type opens (plan §2.1 decision 13): fixed per type. */
export const PRESENTATION_BY_TYPE: Record<string, GuideCardPresentation> = {
  QUIZ: GuideCardPresentation.INLINE,
  JOURNAL: GuideCardPresentation.INLINE,
  BRANCHING_SCENARIO: GuideCardPresentation.INLINE,
  ARTICLE: GuideCardPresentation.SHELF,
  VIDEO: GuideCardPresentation.SHELF,
  BUCKET_SORT: GuideCardPresentation.SHELF,
  ROLEPLAY: GuideCardPresentation.THEATRE,
  CASE: GuideCardPresentation.THEATRE,
  ANNOTATED_ARTIFACT: GuideCardPresentation.THEATRE,
  GAME: GuideCardPresentation.THEATRE,
};

/** The card's verb. The client may localise by (type, action). */
export const CTA_LABEL_BY_TYPE: Record<string, string> = {
  QUIZ: 'Start quiz',
  JOURNAL: 'Write',
  BRANCHING_SCENARIO: 'Begin',
  ARTICLE: 'Read',
  VIDEO: 'Watch',
  BUCKET_SORT: 'Sort',
  ROLEPLAY: 'Start practice',
  CASE: 'Open case',
  ANNOTATED_ARTIFACT: 'Open',
  GAME: 'Play',
};

export type PresentReason = 'next_step' | 'learner_asked' | 'reopen';

export type PresentCheck =
  | { ok: true; item: SpineItem }
  | { ok: false; error: string };

/**
 * The Conductor's rule for presenting an item — the only way an item reaches
 * the learner (plan §7.7): never a locked one; the next step only when the
 * steer level allows or the learner asked; a completed one only to reopen;
 * nothing at all in a crisis.
 */
export function checkPresentable(input: {
  spine: CourseSpine;
  steer: SteerDecision;
  mode: GuideMode;
  itemId: string;
  reason: PresentReason;
  alreadyPresentedThisTurn: boolean;
}): PresentCheck {
  if (input.mode === GuideMode.CRISIS) {
    return { ok: false, error: 'Nothing can be presented right now.' };
  }
  if (input.alreadyPresentedThisTurn) {
    return {
      ok: false,
      error: 'One activity per turn: an item was already presented.',
    };
  }
  const item = input.spine.items.find(
    (candidate) => candidate.id === input.itemId,
  );
  if (!item) {
    return { ok: false, error: 'No such item in this course.' };
  }
  if (item.state === 'locked') {
    return {
      ok: false,
      error:
        'That item is locked: the course order is fixed. Offer the next step instead.',
    };
  }
  if (item.state === 'completed') {
    return { ok: true, item };
  }
  if (input.reason === 'reopen') {
    return { ok: false, error: 'Only completed items can be reopened.' };
  }
  if (input.reason === 'next_step' && !input.steer.mayPresentNext) {
    return {
      ok: false,
      error:
        'Presenting the next step is not allowed right now; present it only if the learner asks.',
    };
  }
  return { ok: true, item };
}

/** Turns between two sign-in suggestions to a visitor. */
export const SIGN_IN_SUGGESTION_GAP_TURNS = 4;

const SUGGEST_SIGN_IN_TOOL: AgentToolDefinition = {
  name: GUIDE_TOOL_NAMES.SUGGEST_SIGN_IN,
  description:
    'Show the visitor a card to sign in, with one line on why it would help them now. Use it when they want to start an activity, ask to save something or see their progress, or the situation report says their messages are nearly used up — not as your first reply, and not again soon after. ' +
    'Example: {"reason":"Sign in to open the first article and keep this conversation."}',
  input_schema: {
    type: 'object',
    properties: {
      reason: {
        type: 'string',
        description:
          'One short line, in your voice, on what signing in lets them do next.',
      },
    },
    required: ['reason'],
    additionalProperties: false,
  },
  strict: true,
};

/**
 * What an anonymous visitor's Ally can do (plan §2.3, §7.3 "visibility"):
 * talk about the public outline, show support resources, and offer sign-in.
 * Nothing that reads or writes a learner — no Tutor over course content, no
 * memory, notebook or progress, no presenting activities.
 */
export const GUIDE_VISITOR_TOOL_NAMES: ReadonlySet<string> = new Set([
  GUIDE_TOOL_NAMES.SHOW_COURSE_INFO,
  GUIDE_TOOL_NAMES.SHOW_WELLBEING_RESOURCES,
  GUIDE_TOOL_NAMES.SUGGEST_SIGN_IN,
]);

export const GUIDE_VISITOR_TOOLS: AgentToolDefinition[] = [
  ...GUIDE_TOOLS.filter((tool) => GUIDE_VISITOR_TOOL_NAMES.has(tool.name)),
  SUGGEST_SIGN_IN_TOOL,
];
