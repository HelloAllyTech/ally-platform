import { ValidatedEndingVocabulary } from 'src/llm-agent/runtime/agent-turn-tools.util';
import { AgentReplyProblem } from 'src/llm-agent/runtime/agent-turn.types';
import {
  AgentReceiptCall,
  AgentReceiptVocabulary,
  clipText,
  plural,
} from 'src/llm-agent/runtime/agent-turn-receipt.util';
import { ROLEPLAY_INTERVIEW_QUESTION_LIMITS } from '../constants/roleplay-interview.constants';

/**
 * What the roleplay interview's validated turns need to know about its tools:
 * which calls only read, which write (update_brief, propose_plan), how a call
 * reads on the receipt, and the claims a reply can be checked on.
 */

export const ROLEPLAY_INTERVIEW_TURN_VOCABULARY: ValidatedEndingVocabulary = {
  userNoun: 'trainer',
  changeNoun: 'the brief or the plan',
  askingTool: 'ask_trainer',
  closingTool: 'finish_turn',
  unchangedField: 'unchangedBecause',
};

export const ROLEPLAY_INTERVIEW_FINISH_WHEN =
  'after propose_plan succeeds (say in one sentence what the roleplay practises; the trainer ' +
  'reviews the plan in the panel), or when you are answering something they asked';

export const ROLEPLAY_INTERVIEW_TURN_RULES = [
  'Never say the plan is ready unless propose_plan succeeded this turn.',
  'Nothing the trainer tells you may be lost: if it fits no brief field, add it to notes ' +
    'with update_brief before you end the turn.',
];

export const ROLEPLAY_INTERVIEW_LOOKUP_TOOLS = new Set([
  'list_competencies',
  'get_competency_behaviours',
  'list_learner_profiles',
  'get_learner_profile',
  'search_characters',
  'list_languages',
  'list_trigger_warnings',
  'design_guidance_search',
]);

export const ROLEPLAY_INTERVIEW_EDIT_TOOLS = new Set([
  'update_brief',
  'propose_plan',
]);

export const ROLEPLAY_INTERVIEW_ENDING_TOOLS = new Set([
  'ask_trainer',
  'finish_turn',
]);

export const isRoleplayInterviewLookup = (name: string): boolean =>
  ROLEPLAY_INTERVIEW_LOOKUP_TOOLS.has(name);

export const isRoleplayInterviewEdit = (name: string): boolean =>
  ROLEPLAY_INTERVIEW_EDIT_TOOLS.has(name);

export function describeRoleplayInterviewAttempt(
  name: string,
  input: Record<string, any> = {},
): string {
  switch (name) {
    case 'list_competencies':
      return input?.query
        ? `Competencies matching "${clipText(input.query, 60)}"`
        : 'Competencies';
    case 'get_competency_behaviours':
      return 'Competency behaviours';
    case 'list_learner_profiles':
      return 'Learner profiles';
    case 'get_learner_profile':
      return `Learner profile ${clipText(input?.id, 40)}`;
    case 'search_characters':
      return `Character Library search "${clipText(input?.description, 80)}"`;
    case 'list_languages':
      return 'Languages';
    case 'list_trigger_warnings':
      return 'Trigger warnings';
    case 'design_guidance_search':
      return 'Learning design principles';
    case 'update_brief':
      return `Update the brief (${Object.keys(input ?? {}).join(', ') || 'nothing'})`;
    case 'propose_plan':
      return `Propose the plan${input?.title ? ` "${clipText(input.title, 60)}"` : ''}`;
    default:
      return name;
  }
}

const lengthOf = (value: unknown): number =>
  Array.isArray(value) ? value.length : 0;

export const ROLEPLAY_INTERVIEW_RECEIPT_VOCABULARY: AgentReceiptVocabulary = {
  isEnding: (name) => ROLEPLAY_INTERVIEW_ENDING_TOOLS.has(name),
  isResearch: isRoleplayInterviewLookup,
  describeAttempt: describeRoleplayInterviewAttempt,
  describeFound: (call: AgentReceiptCall) => {
    switch (call.name) {
      case 'list_competencies':
        return plural(
          lengthOf(call.result?.competencies),
          'competency',
          'competencies',
        );
      case 'search_characters':
        return call.result?.searchFailed
          ? 'the search could not run'
          : plural(lengthOf(call.result?.characters), 'character');
      case 'list_languages':
        return plural(lengthOf(call.result?.languages), 'language');
      case 'list_learner_profiles':
        return plural(lengthOf(call.result?.profiles), 'profile');
      case 'design_guidance_search':
        return plural(lengthOf(call.result?.results), 'principle');
      default:
        return 'done';
    }
  },
};

/** The receipt's "changed", from the turn's own record of what it wrote. */
export function describeRoleplayInterviewChanges(changes: {
  briefFields: Set<string>;
  planVersion: number | null;
}): string[] {
  const lines: string[] = [];
  if (changes.briefFields.size) {
    lines.push(`Brief updated: ${[...changes.briefFields].join(', ')}`);
  }
  if (changes.planVersion !== null) {
    lines.push(`Plan proposed (version ${changes.planVersion})`);
  }
  return lines;
}

/**
 * Prose that tells the trainer something changed. Narrow, as Course
 * Copilot's is: "I'll note that" is a promise, not a claim.
 */
const CLAIMS_A_CHANGE =
  /\b(I'?ve|I have)\s+(just\s+)?(updated|added|recorded|captured|noted|changed|removed|set|saved|drafted|proposed)\b|\b(brief|plan)\s+(is|has been|was)\s+(now\s+)?(updated|ready|saved|changed|complete)\b/i;

export function claimsRoleplayInterviewChange(
  text: string | null | undefined,
): boolean {
  return CLAIMS_A_CHANGE.test(String(text ?? ''));
}

/**
 * The question a turn ends with, checked before the trainer sees it: one
 * short choice with 2-4 options and one recommended. Each problem sends it
 * back once; a second attempt goes out regardless.
 */
export function roleplayInterviewQuestionProblems(ending: {
  name: string;
  input: Record<string, any>;
  message: string;
}): AgentReplyProblem[] {
  if (ending.name !== 'ask_trainer') return [];
  const limits = ROLEPLAY_INTERVIEW_QUESTION_LIMITS;
  const input = ending.input ?? {};
  const prompt = String(input.prompt ?? '').trim();
  const kind = String(input.kind ?? 'singleSelect');
  const options = Array.isArray(input.options) ? input.options : [];
  const problems: AgentReplyProblem[] = [];
  if (kind === 'freeText' || options.length < limits.minOptions) {
    problems.push({
      key: 'choice_only',
      toModel:
        `Ask this as a choice: kind "singleSelect" (or "multiSelect") with ${limits.minOptions}-` +
        `${limits.maxOptions} short options and one recommended. The trainer can still type ` +
        'their own answer.',
      toUser:
        'The agent asked an open question where a choice would have been quicker.',
    });
  }
  // The language question lists the whole catalog: the trainer's screen draws it as a language
  // and voice picker, not as a row of option buttons.
  const isLanguageQuestion = input.field === 'languageIds';
  if (options.length > limits.maxOptions && !isLanguageQuestion) {
    problems.push({
      key: 'too_many_options',
      toModel: `Offer at most ${limits.maxOptions} options.`,
      toUser: 'The agent offered more options than it should.',
    });
  }
  if (
    options.length >= limits.minOptions &&
    !options.some((option: any) => option && option.recommended)
  ) {
    problems.push({
      key: 'no_recommendation',
      toModel:
        'Mark exactly one option recommended:true — the one you would defend.',
      toUser: 'The agent did not say which option it recommends.',
    });
  }
  if (prompt.length > limits.promptChars) {
    problems.push({
      key: 'question_too_long',
      toModel: `Keep the question under ${limits.promptChars} characters. Ask one thing, plainly.`,
      toUser: 'The agent asked a long question.',
    });
  }
  const message = String(ending.message ?? '').trim();
  if (message && message !== prompt && message.length > limits.replyChars) {
    problems.push({
      key: 'reply_too_long',
      toModel:
        'Your message above the question is too long. Say at most one short sentence, or nothing.',
      toUser: 'The agent wrote more than it needed above its question.',
    });
  }
  return problems;
}
