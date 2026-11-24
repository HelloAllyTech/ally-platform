import { TONES } from "./MakeItYours";

import type { LearnedFact, PatchOp } from "./types";

/** The source of a fact the owner typed themselves (ally-be OWNER_SOURCE). */
export const OWNER_SOURCE = "owner";
/** ally-be FACT_MAX_CHARS: the longest one learned fact can be. */
export const FACT_MAX_CHARS = 500;
/** ally-be BotDraftDto.extraNever: at most 20 rules of at most 200 characters. */
export const RULE_MAX_COUNT = 20;
/** The topic itself is kept short, as on the assistant home's "avoid" list. */
export const TOPIC_MAX_CHARS = 80;

export type PatchTarget = "draft" | "learned";

/**
 * Every patch the "Fix this" flows may send. `{n}` stands for a fact's position. Nothing in this
 * UI touches /safetyPackId, /knowledgeDocumentIds, /access or any other path.
 */
export const FIX_THIS_PATHS = [
  { target: "learned", op: "add", path: "/facts/-" },
  { target: "learned", op: "replace", path: "/facts/{n}/text" },
  { target: "draft", op: "add", path: "/extraNever/-" },
  { target: "draft", op: "replace", path: "/tone" },
] as const;

export const isAllowedFixPatch = (target: PatchTarget, ops: PatchOp[]): boolean =>
  ops.length > 0 &&
  ops.every(op =>
    FIX_THIS_PATHS.some(
      allowed =>
        allowed.target === target &&
        allowed.op === op.op &&
        new RegExp(`^${allowed.path.replace("{n}", "\\d+")}$`).test(op.path),
    ),
  );

export interface FixPatch {
  target: PatchTarget;
  ops: PatchOp[];
}

export const correctFactPatch = (index: number, text: string): FixPatch => ({
  target: "learned",
  ops: [{ op: "replace", path: `/facts/${index}/text`, value: text.trim() }],
});

export const factText = (question: string, answer: string): string =>
  `Q: ${question.trim()} A: ${answer.trim()}`;

export const addFactPatch = (question: string, answer: string): FixPatch => ({
  target: "learned",
  ops: [
    {
      op: "add",
      path: "/facts/-",
      value: {
        id: crypto.randomUUID(),
        section: "faqs",
        text: factText(question, answer),
        sourceUrl: OWNER_SOURCE,
        byOwner: true,
      },
    },
  ],
});

export const topicSentence = (topic: string): string => `Don't talk about ${topic.trim()}.`;

export const avoidTopicPatch = (topic: string): FixPatch => ({
  target: "draft",
  ops: [{ op: "add", path: "/extraNever/-", value: topicSentence(topic) }],
});

export const tonePatch = (toneId: (typeof TONES)[number]["id"]): FixPatch => ({
  target: "draft",
  ops: [{ op: "replace", path: "/tone", value: TONES.find(t => t.id === toneId)?.value ?? "warm" }],
});

const STOP_WORDS = new Set(
  "a an and are as at be but by can do does for from had has have how i if in is it its my of on or our so that the their them then there these they this to us was we were what when where which who why will with you your me about any".split(
    " ",
  ),
);

const words = (text: string): Set<string> =>
  new Set(
    (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(
      w => w.length > 1 && !STOP_WORDS.has(w),
    ),
  );

/** The 3 facts sharing the most words with the question; none share any, the 3 most recent. */
export const closestFacts = (
  question: string,
  facts: LearnedFact[],
): { fact: LearnedFact; index: number }[] => {
  const asked = words(question);
  const scored = facts.map((fact, index) => {
    let score = 0;
    words(fact.text).forEach(w => {
      if (asked.has(w)) score += 1;
    });
    return { fact, index, score };
  });
  const overlapping = scored.filter(s => s.score > 0);
  const pool = overlapping.length
    ? overlapping.sort((a, b) => b.score - a.score || b.index - a.index)
    : [...scored].reverse();
  return pool.slice(0, 3).map(({ fact, index }) => ({ fact, index }));
};
