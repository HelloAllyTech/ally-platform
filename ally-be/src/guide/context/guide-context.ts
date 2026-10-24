import { createHash } from 'crypto';
import {
  AgentContentBlock,
  AgentMessage,
  AgentSystemBlock,
} from 'src/llm-agent/type/agent-llm.type';
import { CourseSpine } from '../conductor/course-spine';
import { GuideOrgProfileValue } from '../entity/guide-org-profile.entity';
import { ORCHESTRATOR_SYSTEM_PROMPT } from '../prompts/orchestrator.prompt';
import { enabledSkills, skillIndex } from '../skills/guide-skills';
import { asData } from '../prompts/sentinel.prompt';
import { GuideReleaseBundle } from '../release/guide-release.bundle';

/**
 * The orchestrator's context (plans/ally-guide/plan.md §7.6), as pure
 * functions so the byte-for-byte rules are testable:
 *
 *  - S1 persona + safety core (release)       cached 1h, shared by every thread
 *  - S2 organisation layer                    cached 1h, shared by an org
 *  - S3 course outline + trainer notes        cached 5m, shared by a course
 *  - history                                  replayed exactly, cached as a prefix
 *  - newest turn: <learner_message>, then the situation report as a
 *    mid-conversation system message
 *
 * Nothing that changes within an epoch may appear in S1–S3: item states,
 * scores and mode live in the situation report. A change to any span's text
 * starts a new epoch, because the frozen prefix is what keeps the cache warm
 * and every earlier thinking block valid.
 */

export interface CourseContext {
  title: string;
  description: string | null;
  languageCode: string;
  trainerNotes: string | null;
  spine: CourseSpine;
}

/** Short stable hash of a span, recorded in the epoch snapshot. */
export const spanHash = (text: string): string =>
  createHash('sha256').update(text).digest('hex').slice(0, 16);

/** Course descriptions may hold sanitised HTML; the model gets text. */
export function plainText(html: string | null | undefined): string {
  if (!html) return '';
  return html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

export function buildOrgSpan(profile: GuideOrgProfileValue | null): string {
  if (!profile) {
    return [
      '# Organisation',
      'There is no organisation-specific guidance for this learner. When they',
      'need a supervisor, say "your supervisor, or whoever oversees your',
      'practice", and refer them to their organisation\'s own protocols.',
    ].join('\n');
  }
  const lines = ['# Organisation', '<organisation>'];
  if (profile.supervisorWording) {
    lines.push(
      `<supervisor_wording>${asData(profile.supervisorWording)}</supervisor_wording>`,
    );
  }
  if (profile.protocols) {
    lines.push(
      `<protocols>${asData(clip(profile.protocols, 2000))}</protocols>`,
    );
  }
  if (profile.toneNotes) {
    lines.push(
      `<tone_notes>${asData(clip(profile.toneNotes, 600))}</tone_notes>`,
    );
  }
  if (profile.avoidTopics?.length) {
    lines.push(
      `<topics_to_avoid>${asData(profile.avoidTopics.join('; '))}</topics_to_avoid>`,
    );
  }
  lines.push('</organisation>');
  return lines.join('\n');
}

const TYPE_LABEL: Record<string, string> = {
  ROLEPLAY: 'roleplay',
  CASE: 'case',
  QUIZ: 'quiz',
  ARTICLE: 'article',
  VIDEO: 'video',
  JOURNAL: 'journal',
  ANNOTATED_ARTIFACT: 'annotation',
  GAME: 'game',
  BRANCHING_SCENARIO: 'branching scenario',
  BUCKET_SORT: 'sorting activity',
};

export const itemTypeLabel = (type: string): string =>
  TYPE_LABEL[type] ?? type.toLowerCase();

export function buildCourseSpan(course: CourseContext): string {
  const { spine } = course;
  const totalMinutes = spine.items.reduce(
    (sum, item) => sum + item.estimatedMinutes,
    0,
  );
  const lines = [
    '# This course',
    `<course title="${asData(course.title)}" language="${asData(
      course.languageCode,
    )}" items="${spine.total}" estimated_minutes="${totalMinutes}">`,
  ];
  const description = plainText(course.description);
  if (description) {
    lines.push(`<description>${asData(clip(description, 1200))}</description>`);
  }
  for (const section of spine.sections) {
    lines.push(
      `<chapter number="${section.index + 1}" title="${asData(section.title)}">`,
    );
    for (const id of section.itemIds) {
      const item = spine.items.find((candidate) => candidate.id === id);
      if (!item) continue;
      const attrs = [
        `id="${item.id}"`,
        `type="${itemTypeLabel(item.type)}"`,
        `minutes="${item.estimatedMinutes}"`,
        `tension="${item.tension}"`,
        ...(item.boss ? ['practice="true"'] : []),
        ...(item.triggerWarnings.length
          ? [`content_warnings="${asData(item.triggerWarnings.join(', '))}"`]
          : []),
      ].join(' ');
      const summary = item.description
        ? ` — ${asData(clip(plainText(item.description), 200))}`
        : '';
      lines.push(`<item ${attrs}>${asData(item.title)}${summary}</item>`);
    }
    lines.push('</chapter>');
  }
  lines.push('</course>');
  if (course.trainerNotes?.trim()) {
    lines.push(
      "<trainer_notes>The course's trainer wrote these notes for you:",
      asData(clip(course.trainerNotes.trim(), 1500)),
      '</trainer_notes>',
    );
  }
  return lines.join('\n');
}

export interface SystemSpans {
  blocks: AgentSystemBlock[];
  hashes: { persona: string; org: string; course: string };
}

export function buildSystemSpans(
  bundle: GuideReleaseBundle,
  orgSpan: string,
  courseSpan: string,
): SystemSpans {
  // The skill index lives in S1 with the persona: it changes only with the
  // release, so it shares the release's hour-long cache (plan §7.6).
  const skills = skillIndex(enabledSkills(bundle));
  const persona = [
    bundle.prompts.orchestrator?.text ?? ORCHESTRATOR_SYSTEM_PROMPT,
    ...(skills ? [skills] : []),
    ...(bundle.lessonSnapshot.length
      ? [
          '# Lessons from earlier conversations',
          ...bundle.lessonSnapshot.map((lesson) => `- ${lesson}`),
        ]
      : []),
  ].join('\n\n');
  return {
    // Longest-lived first: the API needs 1h breakpoints before 5m ones.
    blocks: [
      { text: persona, cache: '1h' },
      { text: orgSpan, cache: '1h' },
      { text: courseSpan, cache: true },
    ],
    hashes: {
      persona: spanHash(persona),
      org: spanHash(orgSpan),
      course: spanHash(courseSpan),
    },
  };
}

export interface ConversationLine {
  role: 'learner' | 'ally';
  text: string;
}

/** What a new epoch is told about the learner and the conversation so far. */
export function buildEpochOpener(input: {
  firstName: string | null;
  guidance: string;
  recent: ConversationLine[];
  reason: string;
  /** What Ally remembers about the learner (they can see and delete it). */
  memories?: Array<{ kind: string; body: string }>;
}): string {
  const lines = ['<epoch_context>'];
  if (input.firstName) {
    lines.push(`Learner's first name: ${asData(input.firstName)}.`);
  }
  lines.push(`Guidance they asked for: ${input.guidance}.`);
  if (input.memories?.length) {
    lines.push(
      'What you remember about them (from earlier conversations; use it lightly, never recite it):',
      '<memory>',
      ...input.memories.map(
        (memory) => `- (${memory.kind}) ${asData(memory.body)}`,
      ),
      '</memory>',
    );
  }
  if (input.recent.length) {
    lines.push(
      `The conversation is resuming (${input.reason}). The last messages, oldest first:`,
      '<recent_conversation>',
      ...input.recent.map(
        (line) =>
          `<${line.role}>${asData(clip(line.text, 500))}</${line.role}>`,
      ),
      '</recent_conversation>',
    );
  } else {
    lines.push('This is the start of your conversation with this learner.');
  }
  lines.push('</epoch_context>');
  return lines.join('\n');
}

const INTENT_TEXT: Record<string, string> = {
  start: 'The learner pressed Start.',
  continue: 'The learner pressed Continue.',
  locked_peek: 'The learner tapped a locked item to see what is ahead.',
  not_now: 'The learner pressed "Not now".',
  safe_now: 'The learner tapped "I\'m safe right now" on the crisis card.',
};

/**
 * Lines of a reply that echo the conversation's own scaffolding — an intent
 * note, a tag — rather than speak to the learner. A model continuing the
 * transcript instead of answering writes them; they never reach the learner.
 */
const ECHO_PATTERNS: RegExp[] = [
  ...Object.values(INTENT_TEXT).map(
    (text) =>
      new RegExp(
        `^\\s*${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`,
        'i',
      ),
  ),
  /^\s*<\/?(learner_message|learner_action|platform_event|situation_report|asking_about)\b/i,
  /^\s*(learner|user|ally|assistant)\s*:/i,
];

/** The reply without echoed scaffolding lines; `stripped` says if any went. */
export function stripEchoedScaffolding(text: string): {
  text: string;
  stripped: boolean;
} {
  const lines = text.split('\n');
  const kept = lines.filter(
    (line) => !ECHO_PATTERNS.some((pattern) => pattern.test(line)),
  );
  return {
    text: kept.join('\n').trim(),
    stripped: kept.length !== lines.length,
  };
}

export interface LearnerTurnInput {
  text: string;
  intent?: string | null;
  anchor?: {
    itemId: string;
    quote?: string | null;
    timestampSec?: number | null;
  } | null;
  epochOpener?: string | null;
  /** Things that happened on the platform since the last turn. */
  platformEvents?: string[];
}

/** The newest user message: everything the learner contributed, as data. */
export function buildLearnerMessage(input: LearnerTurnInput): AgentMessage {
  const blocks: AgentContentBlock[] = [];
  if (input.epochOpener) blocks.push({ type: 'text', text: input.epochOpener });
  for (const event of input.platformEvents ?? []) {
    blocks.push({
      type: 'text',
      text: `<platform_event>${asData(event)}</platform_event>`,
    });
  }
  if (input.intent && INTENT_TEXT[input.intent]) {
    blocks.push({
      type: 'text',
      text: `<learner_action>${INTENT_TEXT[input.intent]}</learner_action>`,
    });
  }
  if (input.anchor) {
    const parts = [`item_id="${asData(input.anchor.itemId)}"`];
    if (input.anchor.timestampSec != null) {
      parts.push(`at_seconds="${Math.floor(input.anchor.timestampSec)}"`);
    }
    blocks.push({
      type: 'text',
      text:
        `<asking_about ${parts.join(' ')}>` +
        (input.anchor.quote ? asData(clip(input.anchor.quote, 1000)) : '') +
        '</asking_about>',
    });
  }
  if (input.text.trim()) {
    blocks.push({
      type: 'text',
      text: `<learner_message>${asData(input.text.trim())}</learner_message>`,
    });
  }
  return { role: 'user', content: blocks };
}
