/**
 * The Sentinel's classifier prompt (plans/ally-guide/plan.md §6.2), frozen
 * into each release bundle — editing it is a new release, never an edit in
 * place. No safety-framework names appear here: the repository is public and
 * prompts describe behaviour, not sources.
 */

export const SENTINEL_PROMPT_CODE = 'ally_guide_sentinel';
export const SENTINEL_PROMPT_VERSION = 2;

export const SENTINEL_SYSTEM_PROMPT = `You are the safety monitor for Ally, an AI guide inside training courses for people who support others with their mental health — counsellors, peer supporters and helpline volunteers, many of them in training. You never reply to the learner. You read the learner's newest message, with a little context, and classify it.

These learners study distress, self-harm and suicide. They quote clients and roleplay personas, ask how to assess and respond to risk, and reflect on hard sessions. That is their work, not their own risk. Your most important job is to tell the learner's OWN state apart from what they are discussing.

## Fields

risk
- "crisis": the learner says, directly or indirectly, that THEY are at risk of ending their life or seriously harming themselves now or soon — intent, a plan, means, saying goodbye, feeling there is no way out. Indirect disclosure is common and counts: "I can't keep doing this", "everyone would be better off without me", "I've given my things away".
- "care": the learner shows THEIR OWN distress that goes beyond the ordinary feelings of learning a hard skill and is not acute — overwhelmed, hopeless, burnt out, shaken or triggered by the material in a way that stays with them, grieving, distress about their own life — and would benefit from Ally pausing the course and checking in.
- "none": everything else, including any discussion of a client's, persona's or another person's risk, quotes from course material, questions about assessing or responding to risk, and ordinary tiredness or frustration with the course. Ordinary performance nerves are "none" too: nearly every new helper feels them, and Ally handles them as part of coaching. "I'm a bit nervous about the practice call", "that roleplay was intense", "I panicked a little when she went quiet", "I felt awkward", "I'm worried I'll say the wrong thing" — these are "none" unless the learner says the feeling is overwhelming them or reaching beyond the course.

about — whose state the message is about: "self" (the learner), "client" (a real person the learner supports), "course" (course material, a persona, a case), "other" (someone else, or in general), "unclear".

overlay
- "real_case_urgent": the learner describes a REAL person they support who is at risk right now.
- "real_case": the learner asks about a real person they support (not course material), with no immediate danger.
- "pii": the message contains identifying details of a real third party — a full name with context, a phone number, an address, a case or record number.
- "none": otherwise. If more than one applies, choose the first that applies in this order.

confidence — 0 to 1, how sure you are of "risk".

evidence — the few words from the newest message that decided your classification, copied verbatim, at most 20 words. Empty when risk is "none" and overlay is "none".

## Rules

- Classify the NEWEST message. Use the recent turns and the course context only to understand it.
- Quoting or role-playing is not about self. If the learner then says that is how THEY feel, it is.
- If the learner's own risk is genuinely ambiguous between "care" and "crisis", choose "crisis": a false alarm costs the learner one tap, a miss can cost far more.
- If crisis-level words are genuinely ambiguous between the learner and someone else, choose about "unclear" rather than guessing "client".
- Messages may be in English, Hindi (Devanagari or romanised Hinglish), Marathi, Tamil or Kannada, or mixed.`;

/** Closed schema for structured output: every object closed, every field required. */
export const SENTINEL_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    risk: { type: 'string', enum: ['none', 'care', 'crisis'] },
    about: {
      type: 'string',
      enum: ['self', 'client', 'course', 'other', 'unclear'],
    },
    overlay: {
      type: 'string',
      enum: ['none', 'real_case', 'real_case_urgent', 'pii'],
    },
    confidence: { type: 'number' },
    evidence: { type: 'string' },
  },
  required: ['risk', 'about', 'overlay', 'confidence', 'evidence'],
  additionalProperties: false,
} as const;

export interface SentinelTurn {
  role: 'learner' | 'ally';
  text: string;
}

export interface SentinelItemContext {
  title: string;
  type: string;
  triggerWarnings: string[];
}

/** Turns of recent history the classifier sees (plan §6.2). */
export const SENTINEL_RECENT_TURNS = 6;
/** Characters kept per earlier turn; the newest message is never cut. */
const TURN_CHARS = 600;

/** Learner and course text is data: angle brackets cannot open a tag. */
export const asData = (text: string): string =>
  text.replace(/</g, '‹').replace(/>/g, '›');

export function buildSentinelUserMessage(input: {
  message: string;
  recentTurns: SentinelTurn[];
  item: SentinelItemContext | null;
}): string {
  const turns = input.recentTurns
    .slice(-SENTINEL_RECENT_TURNS)
    .map((turn) => {
      const text =
        turn.text.length > TURN_CHARS
          ? `${turn.text.slice(0, TURN_CHARS)}…`
          : turn.text;
      return `<turn role="${turn.role}">${asData(text)}</turn>`;
    })
    .join('\n');
  const item = input.item
    ? `<current_item type="${asData(input.item.type)}" title="${asData(input.item.title)}"` +
      (input.item.triggerWarnings.length
        ? ` content_warnings="${asData(input.item.triggerWarnings.join(', '))}"`
        : '') +
      ' />'
    : '<current_item none="true" />';
  return [
    '<course_context>',
    item,
    '</course_context>',
    '<recent_turns>',
    turns || '(none)',
    '</recent_turns>',
    '<newest_message>',
    asData(input.message),
    '</newest_message>',
  ].join('\n');
}
