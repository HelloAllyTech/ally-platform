/**
 * The curator's prompt (plans/ally-guide/plan.md §7.13 loop 2): turns the
 * evidence the learning loop trusts into a few small, specific changes for
 * the next release. Kept in code, not in the release, for the same reason as
 * the evaluator's: the loop must not be able to rewrite the instructions it
 * improves itself by. Bump the version on any edit.
 *
 * Public repository: behaviour only, no sources.
 */

export const CURATOR_PROMPT_VERSION = 1;

export const CURATOR_SYSTEM_PROMPT = `You improve Ally, an AI guide inside short training courses for counsellors, peer supporters and helpline volunteers. Each night you read what went wrong in Ally's recent conversations and propose a few small changes for the next version of Ally. People and automated checks review every change before any learner sees it.

You receive:
- <evidence>: clusters of failures the team trusts. Each has an id, what failed (a rubric criterion or an automatic check), where (everywhere, one organisation, or one course), how many turns and learners, and short reasons written by reviewers or judges. You never see what learners wrote, and you must not guess it.
- <playbook>: the lessons Ally already follows, by scope.
- <policy>: the settings you may change, with their current values and allowed ranges.
- <prompts>: the instructions you may edit, by role.

Propose at most five changes, best first. Three kinds:
1. lesson — one sentence Ally will read in its instructions from now on, for the scope of the cluster you cite. Write it as a habit, in the second person, specific and checkable ("When a learner says they are short of time, offer the shortest next step first."). 20 to 280 characters. Never describe a person, an organisation or a conversation; never quote anyone; never include names, numbers, places or anything a learner might have written.
2. policy — a new value for one listed setting, inside its range, when the evidence shows the current value causes the failure. Only from a cluster that applies everywhere.
3. prompt — replace one exact passage of one listed role's instructions ("find" must be copied character for character and occur once) with a better one of at most 600 characters. Only from a cluster that applies everywhere. Prefer a lesson unless the instruction itself is wrong.

Rules:
- Every change cites exactly one evidence id ("clusterId") and says in one sentence why it would fix that failure ("rationale").
- Do not repeat or contradict a lesson already in the playbook.
- Do not touch how Ally handles risk, crisis, harm, diagnosis or referral, and do not change safety wording. Those changes belong to people.
- Do not make Ally more persuasive, more praising, more frequent or more engaging for its own sake. A change must make learning better, not just keep learners chatting.
- If no change is clearly supported, return empty lists. Fewer, better changes beat many.

Return JSON only, matching the schema.`;

export interface CuratorEvidence {
  id: string;
  signal: string;
  scope: string;
  turns: number;
  learners: number;
  tenants: number;
  reasons: string[];
  /** For a rubric criterion: what a fail looks like. */
  failAnchor?: string | null;
}

export interface CuratorRequest {
  evidence: CuratorEvidence[];
  playbook: Array<{ scope: string; text: string }>;
  policy: Array<{
    key: string;
    value: unknown;
    min?: number;
    max?: number;
    description: string;
  }>;
  prompts: Array<{ role: string; text: string }>;
}

const attr = (value: string) => value.replace(/[<>"]/g, ' ');

export function buildCuratorMessage(input: CuratorRequest): string {
  const lines = ['<evidence>'];
  for (const cluster of input.evidence) {
    lines.push(
      `<cluster id="${attr(cluster.id)}" failed="${attr(cluster.signal)}" scope="${attr(cluster.scope)}" turns="${cluster.turns}" learners="${cluster.learners}" organisations="${cluster.tenants}">`,
    );
    if (cluster.failAnchor)
      lines.push(`What a fail looks like: ${cluster.failAnchor}`);
    for (const reason of cluster.reasons) lines.push(`- ${attr(reason)}`);
    lines.push('</cluster>');
  }
  lines.push('</evidence>', '<playbook>');
  for (const lesson of input.playbook) {
    lines.push(`- (${lesson.scope}) ${attr(lesson.text)}`);
  }
  lines.push('</playbook>', '<policy>');
  for (const key of input.policy) {
    lines.push(
      `- ${key.key} = ${JSON.stringify(key.value)}${
        key.min !== undefined || key.max !== undefined
          ? ` (range ${key.min ?? '…'}–${key.max ?? '…'})`
          : ''
      }: ${key.description}`,
    );
  }
  lines.push('</policy>', '<prompts>');
  for (const prompt of input.prompts) {
    lines.push(`<prompt role="${prompt.role}">`, prompt.text, '</prompt>');
  }
  lines.push('</prompts>', 'Propose your changes.');
  return lines.join('\n');
}

export const CURATOR_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['lessons', 'policyTweaks', 'promptTweaks'],
  properties: {
    lessons: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['clusterId', 'text', 'rationale'],
        properties: {
          clusterId: { type: 'string' },
          text: { type: 'string' },
          rationale: { type: 'string' },
        },
      },
    },
    policyTweaks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['clusterId', 'key', 'value', 'rationale'],
        properties: {
          clusterId: { type: 'string' },
          key: { type: 'string' },
          value: { type: 'number' },
          rationale: { type: 'string' },
        },
      },
    },
    promptTweaks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['clusterId', 'role', 'find', 'replace', 'rationale'],
        properties: {
          clusterId: { type: 'string' },
          role: { type: 'string' },
          find: { type: 'string' },
          replace: { type: 'string' },
          rationale: { type: 'string' },
        },
      },
    },
  },
} as const;
