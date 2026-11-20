/**
 * Mechanical checks behind the blog review pass (check_draft). They cannot judge a claim, but they
 * catch the mistakes that kept coming back: retrospective sections, internal words an outsider
 * cannot read, and lines that promise more than anyone has shown.
 */
export interface StyleIssue {
  kind:
    | 'retrospective_heading'
    | 'internal_term'
    | 'unproven_claim'
    | 'aside_dash';
  found: string;
  where: 'title' | 'tldr' | 'body' | 'heading';
  why: string;
  fix: string;
}

/** Headings about what is not done, what went wrong or lessons: not allowed in a post. */
const RETROSPECTIVE_HEADING =
  /\b(not (done|measured|built|yet)|haven'?t (done|measured)|what went wrong|went wrong|what we got wrong|mistakes?|lessons?( learned)?|what we learned|limitations?|known issues?|still to do|open questions?|caveats?)\b/i;

/** Team and code words a reader outside Ally cannot read. */
export const INTERNAL_TERMS: readonly string[] = [
  'tier 0',
  'tier 1',
  'tier zero',
  'fixed floor',
  'the floor',
  'risk cue',
  'locked prompt',
  'kill switch',
  'the fence',
  'a fence',
  'inside a fence',
  'skills store',
  'canary',
  'rollout ladder',
  'endpoint',
  'migration',
  'feature flag',
  'gpt-',
  'gemini',
];

/** Lines that promise an outcome, a first, or a trend nobody has shown. */
const UNPROVEN: ReadonlyArray<[RegExp, string]> = [
  [
    /\b(the )?(first|only|best|fastest|most (accurate|advanced))\b/i,
    'a first or a best',
  ],
  [
    /\b(revolutionary|seamless(ly)?|game-?changing|cutting-?edge|state-of-the-art|world-?class)\b/i,
    'hype',
  ],
  [
    /\b(human-?like|natural-?sounding|actually talk|the way people (actually )?(talk|speak|do))\b/i,
    'an outcome claim about sounding human',
  ],
  [
    /\b(gets?|getting|get) (better|smarter) (every|each)\b/i,
    'a trend nobody has shown',
  ],
  [
    /\b(better|safer|smarter|faster) every (week|day|month)\b/i,
    'a trend nobody has shown',
  ],
  [/\b(safe|safely)\b/i, 'a safety claim'],
];

const stripTags = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const headings = (html: string): string[] =>
  [...html.matchAll(/<h[1-4][^>]*>(.*?)<\/h[1-4]>/gis)].map((m) =>
    stripTags(m[1]),
  );

const snippet = (text: string, at: number, len: number) =>
  text
    .slice(Math.max(0, at - 30), at + len + 30)
    .replace(/\s+/g, ' ')
    .trim();

export function findStyleIssues(post: {
  title?: string | null;
  tldr?: string | null;
  body?: string | null;
}): StyleIssue[] {
  const issues: StyleIssue[] = [];
  const parts: Array<['title' | 'tldr' | 'body', string]> = [
    ['title', post.title ?? ''],
    ['tldr', post.tldr ?? ''],
    ['body', stripTags(post.body ?? '')],
  ];

  for (const h of headings(post.body ?? '')) {
    if (RETROSPECTIVE_HEADING.test(h)) {
      issues.push({
        kind: 'retrospective_heading',
        found: h,
        where: 'heading',
        why: 'A post does not have a section about what is not done, what went wrong or lessons.',
        fix: 'Delete the section. Keep a real limit as a short phrase where it matters.',
      });
    }
  }

  for (const [where, text] of parts) {
    const lower = text.toLowerCase();
    for (const term of INTERNAL_TERMS) {
      const i = lower.indexOf(term);
      if (i < 0) continue;
      // Whole-word match for short words.
      const before = lower[i - 1] ?? ' ';
      const after = lower[i + term.length] ?? ' ';
      if (
        /[a-z0-9]/.test(before) ||
        (/[a-z0-9]/.test(after) && !term.endsWith('-'))
      )
        continue;
      issues.push({
        kind: 'internal_term',
        found: snippet(text, i, term.length),
        where,
        why: `"${term}" is an internal word. A reader outside Ally cannot read it.`,
        fix: 'Say what it does in plain words. Call a helper program an agent and explain its role once.',
      });
    }
    for (const [pattern, label] of UNPROVEN) {
      const m = pattern.exec(text);
      if (m) {
        issues.push({
          kind: 'unproven_claim',
          found: snippet(text, m.index, m[0].length),
          where,
          why: `This reads as ${label}. It needs evidence in the research brief or the person's approval.`,
          fix: 'Describe what the thing does instead, or give the measured number with its source and date.',
        });
      }
    }
    const dash = /\s[—–]\s/.exec(text);
    if (dash) {
      issues.push({
        kind: 'aside_dash',
        found: snippet(text, dash.index, 3),
        where,
        why: 'A dash used for an aside.',
        fix: 'Use a full stop, a comma or brackets.',
      });
    }
  }
  return issues;
}
