import type { ReplyLanguage } from './reply-language';

/**
 * TF1 S7: a worry about a child's safety ("A child just told me her uncle hurts her at home. What
 * do I do?", "Who do I call if I'm worried about a child's safety?"). The crisis check rightly
 * flags these, but the fixed at-risk reply is worded for self-harm and carries none of the
 * organisation's own safeguarding procedure. So, unless the person is also at risk themselves
 * (the check's `self_harm`), the assistant answers from its own information (a handbook's
 * Designated Safeguarding Lead, "report the same day") and the reply always ends with the fixed
 * child-protection numbers.
 *
 * Each rule needs a child and a harm or a worry close together, so "how many children attend the
 * Saturday class?" stays a question.
 */
const CHILD = String.raw`(?<![\p{L}\p{M}])(?:child(?:ren|'s)?|kids?|boys?|girls?|students?|learners?|minors?|teen(?:ager)?|(?:little|young) (?:one|boy|girl)|bachch?[aei]|bacch?[aei]|bachch?on|ladk[aei]|बच्च[ाेीो]|बच्चों|बच्ची|लड़क[ाीे]|छात्र[ाा]?)(?![\p{L}\p{M}])`;
const HARM = String.raw`(?:hurt(?:s|ing)? (?:her|him|them)|abus\w*|beat(?:s|en|ing)?|hits? (?:her|him|them)|touch(?:es|ed|ing)? (?:her|him|them)|molest\w*|harass\w*|neglect\w*|unsafe|not safe|(?:'s|s'|their|her|his) safety|in danger|being (?:hurt|harmed)|mistreat\w*|maar(?:ta|ti|te)|chhoo?(?:ta|ti|te)|shoshan|मार(?:ता|ती|ते)|छू(?:ता|ती|ते)|शोषण|परेशान कर)`;
const NEAR = String.raw`[^.!?\n]{0,60}?`;

const RULES = [
  new RegExp(`${CHILD}${NEAR}${HARM}|${HARM}${NEAR}${CHILD}`, 'iu'),
  // "worried about a child", "concerned for a student".
  new RegExp(
    String.raw`(?:worried|concerned|scared|afraid|chinta|चिंता)${NEAR}${CHILD}`,
    'iu',
  ),
];

/** Whether the message is a worry about a child's safety. */
export function isChildSafeguarding(text: string | null | undefined): boolean {
  const t = text ?? '';
  return RULES.some((rule) => rule.test(t));
}

// COPY: needs approval (TF1 S7). The fixed lines every safeguarding reply ends with.
const LINES: Record<'india' | 'elsewhere', Record<'en' | 'hi', string>> = {
  india: {
    en: 'If a child is in danger right now, call 112. Childline: 1098, free, any time.',
    hi: 'अगर किसी बच्चे को अभी खतरा है, तो 112 पर कॉल करें। चाइल्डलाइन: 1098, मुफ़्त, किसी भी समय।',
  },
  elsewhere: {
    en: 'If a child is in danger right now, call your local emergency number.',
    hi: 'अगर किसी बच्चे को अभी खतरा है, तो अपने यहाँ के आपातकालीन नंबर पर कॉल करें।',
  },
};

/** The fixed child-protection line, in the person's language. */
export function safeguardingLine(
  language: ReplyLanguage,
  india: boolean,
): string {
  const set = LINES[india ? 'india' : 'elsewhere'];
  return language === 'hi' ? set.hi : set.en;
}

/** The reply with the fixed line at the end, unless it already carries it. */
export function withSafeguardingLine(
  body: string,
  language: ReplyLanguage,
  india: boolean,
): string {
  const line = safeguardingLine(language, india);
  if (india && /\b1098\b/.test(body) && /\b112\b/.test(body)) return body;
  return body.trim() ? `${body.trim()}\n\n${line}` : line;
}
