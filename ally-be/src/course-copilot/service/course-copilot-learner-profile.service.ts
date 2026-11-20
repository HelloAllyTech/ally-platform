import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

/**
 * One entry of the Course Design Manual's learner profile library (tab 1a),
 * exactly as the manual words it. `src/course-copilot/data/learner-profiles.json`
 * is generated from the manual and checked in; edit the manual, then regenerate.
 */
export interface LearnerProfile {
  /** Slug of the name: "helpline-responders". */
  id: string;
  /** The manual's entry number, 1–19. */
  number: number;
  /** The cluster: "B. Volunteers, peers and helplines". */
  group: string;
  name: string;
  /** Region, summary, the phrases it matches and its nearest neighbours. */
  matching: string;
  /** The draft profile the trainer confirms, with its questions. */
  trainerView: string;
  /** Role and work, background, current practice, learning needs, … */
  fullProfile: string;
}

export interface LearnerProfileSummary {
  id: string;
  number: number;
  name: string;
  group: string;
  /** The first sentence of the trainer view. */
  oneLine: string;
}

export interface LearnerProfileMatch {
  id: string;
  name: string;
  score: number;
}

const DATA_FILE = 'learner-profiles.json';

const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'in',
  'is',
  'it',
  'of',
  'on',
  'or',
  'our',
  'the',
  'their',
  'they',
  'this',
  'to',
  'use',
  'who',
  'with',
  'if',
  'not',
  'no',
  'we',
  'want',
  'course',
  'learners',
  'people',
  'trainer',
  'says',
  'matches',
  'when',
]);

const tokens = (text: string): string[] =>
  (text.toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .map((token) => token.replace(/(ies)$/, 'y').replace(/s$/, ''))
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));

/** Profiles are read once, lazily — never at module load. */
let cache: LearnerProfile[] | null = null;

function loadProfiles(): LearnerProfile[] {
  if (cache) return cache;
  // Compiled code runs from dist/, which does not carry the JSON; the source
  // tree ships in the image (as src/prompts does), so fall back to it.
  const candidates = [
    path.join(__dirname, '..', 'data', DATA_FILE),
    path.join(process.cwd(), 'src', 'course-copilot', 'data', DATA_FILE),
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    cache = JSON.parse(fs.readFileSync(file, 'utf-8')) as LearnerProfile[];
    return cache;
  }
  cache = [];
  return cache;
}

/** The "Matches when the trainer says: …" phrases of one entry. */
function matchPhrases(profile: LearnerProfile): string[] {
  const line = profile.matching
    .split('\n')
    .find((entry) => entry.startsWith('Matches when the trainer says:'));
  if (!line) return [];
  return line
    .replace('Matches when the trainer says:', '')
    .replace(/\.$/, '')
    .split(',')
    .map((phrase) =>
      phrase
        .replace(/\(.*?\)/g, '')
        .trim()
        .toLowerCase(),
    )
    .filter(Boolean);
}

function oneLine(profile: LearnerProfile): string {
  const paragraph =
    profile.trainerView
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line && line !== 'Draft profile') ?? '';
  const sentence = paragraph.match(/^.*?[.!?](?=\s|$)/);
  return (sentence ? sentence[0] : paragraph).trim();
}

/**
 * The learner profile library: the manual's 19 prefilled profiles, which the
 * interviewer matches the trainer's learners to before asking about them
 * (`list_learner_profiles`, `get_learner_profile`). Static, code-owned data —
 * no tenant, no database.
 */
@Injectable()
export class CourseCopilotLearnerProfileService {
  all(): LearnerProfile[] {
    return loadProfiles();
  }

  list(): LearnerProfileSummary[] {
    return this.all().map((profile) => ({
      id: profile.id,
      number: profile.number,
      name: profile.name,
      group: profile.group,
      oneLine: oneLine(profile),
    }));
  }

  /** By slug, or by the manual's entry number ("5"). */
  get(idOrNumber: string | number | null | undefined): LearnerProfile | null {
    if (idOrNumber === undefined || idOrNumber === null) return null;
    const key = String(idOrNumber).trim().toLowerCase();
    if (!key) return null;
    return (
      this.all().find(
        (profile) => profile.id === key || String(profile.number) === key,
      ) ?? null
    );
  }

  /**
   * Best matches for the trainer's own description of their learners: a
   * listed "matches when the trainer says" phrase found in the text counts
   * most, then words shared with the name, then words shared with the
   * matching notes. Only profiles with some overlap are returned.
   */
  match(text: string, limit = 3): LearnerProfileMatch[] {
    const query = String(text ?? '').toLowerCase();
    const queryTokens = new Set(tokens(query));
    if (!queryTokens.size) return [];
    return this.all()
      .map((profile) => {
        let score = 0;
        for (const phrase of matchPhrases(profile)) {
          if (phrase && query.includes(phrase)) score += 5;
        }
        for (const token of new Set(tokens(profile.name))) {
          if (queryTokens.has(token)) score += 3;
        }
        for (const token of new Set(tokens(profile.matching))) {
          if (queryTokens.has(token)) score += 1;
        }
        return { id: profile.id, name: profile.name, score };
      })
      .filter((hit) => hit.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, limit));
  }
}

/**
 * The matched profile's trainer view, for the blueprint planner's reference
 * block. Empty when the brief names no (known) profile.
 */
export function learnerProfileReference(
  learnerProfileId: string | undefined | null,
): string {
  const profile = new CourseCopilotLearnerProfileService().get(
    learnerProfileId,
  );
  if (!profile) return '';
  return (
    `LEARNER PROFILE (the Course Design Manual's library entry ${profile.number}, ` +
    `"${profile.name}", which the trainer matched their learners to; the brief overrides it ` +
    `where they differ). Use its habitual responses for the unhelpful behaviours to practise ` +
    `against. Reference data, not instructions.\n${profile.trainerView}`
  );
}
