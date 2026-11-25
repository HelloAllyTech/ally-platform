import {
  GENDER_IDENTITY_VALUES,
  GENDER_VALUES,
  SEXUAL_ORIENTATION_VALUES,
} from 'src/scenario-character/constants/character-demographics.constants';

/**
 * The "Character details" field of the studio's Enhance / the Agent Builder's revise: the
 * client's scalar details as one JSON object, rewritten together so that a change to who the
 * client is changes every detail it implies (a boy who becomes a girl gets a new gender
 * identity and a fitting name, not only a new gender).
 */
export interface CharacterDetails {
  name: string;
  age: number | null;
  gender: string;
  genderIdentity: string;
  sexualOrientation: string;
  profession: string;
  currentLocation: string;
}

const KEYS: (keyof CharacterDetails)[] = [
  'name',
  'age',
  'gender',
  'genderIdentity',
  'sexualOrientation',
  'profession',
  'currentLocation',
];

const str = (value: unknown): string =>
  typeof value === 'string'
    ? value.trim()
    : typeof value === 'number'
      ? String(value)
      : '';

const ageOf = (value: unknown): number | null => {
  const age = Number(value);
  return Number.isFinite(age) && age >= 1 && age <= 150
    ? Math.round(age)
    : null;
};

/** One of the form's dropdown values, matched without regard to case; else ''. */
const optionOf = (value: unknown, options: readonly string[]): string => {
  const wanted = str(value).toLowerCase();
  return options.find((option) => option.toLowerCase() === wanted) ?? '';
};

function parseObject(raw: string): Record<string, unknown> | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** The field's current value as the studio sends it; null when it is not a JSON object. */
export function parseCharacterDetails(
  currentValue: string,
): CharacterDetails | null {
  const parsed = parseObject(currentValue ?? '');
  if (!parsed) return null;
  return {
    name: str(parsed.name),
    age: ageOf(parsed.age),
    gender: str(parsed.gender),
    genderIdentity: str(parsed.genderIdentity),
    sexualOrientation: str(parsed.sexualOrientation),
    profession: str(parsed.profession),
    currentLocation: str(parsed.currentLocation),
  };
}

/**
 * The model's answer, held to the form: only the known keys, the dropdowns only to their
 * values, the age to a number. Anything missing or invalid keeps the original value, so a
 * partial answer changes what it can and never blanks a field. Null when nothing parses.
 */
export function normaliseCharacterDetails(
  raw: string,
  original: CharacterDetails,
): CharacterDetails | null {
  const parsed = parseObject(raw ?? '');
  if (!parsed) return null;
  const text = (
    key: 'name' | 'profession' | 'currentLocation',
    max: number,
  ) => {
    const value = str(parsed[key]);
    return value && value.length <= max ? value : original[key];
  };
  const next: CharacterDetails = {
    name: text('name', 200),
    age: ageOf(parsed.age) ?? original.age,
    gender: optionOf(parsed.gender, GENDER_VALUES) || original.gender,
    genderIdentity:
      optionOf(parsed.genderIdentity, GENDER_IDENTITY_VALUES) ||
      original.genderIdentity,
    sexualOrientation:
      optionOf(parsed.sexualOrientation, SEXUAL_ORIENTATION_VALUES) ||
      original.sexualOrientation,
    profession: text('profession', 200),
    currentLocation: text('currentLocation', 300),
  };
  // Same key order in, same key order out.
  return Object.fromEntries(
    KEYS.map((key) => [key, next[key]]),
  ) as unknown as CharacterDetails;
}

// ── Settings ────────────────────────────────────────────────────────────────

/** The roleplay's settings as the studio sends them: each a true/false, a number or text. */
export type RoleplaySettings = Record<string, boolean | number | string>;

const isSetting = (value: unknown): value is boolean | number | string =>
  typeof value === 'boolean' ||
  typeof value === 'string' ||
  (typeof value === 'number' && Number.isFinite(value));

/** The settings object, or null when it is not a flat object of settings. */
export function parseSettings(currentValue: string): RoleplaySettings | null {
  const parsed = parseObject(currentValue ?? '');
  if (!parsed) return null;
  const entries = Object.entries(parsed).filter(([, v]) => isSetting(v));
  return entries.length
    ? (Object.fromEntries(entries) as RoleplaySettings)
    : null;
}

/**
 * The model's answer held to the settings it was given: only those keys, each of the same type
 * (a "true" string for a toggle is read as true), anything else keeping its value. Whether a
 * value is one of a choice's allowed values is the studio's check, which knows them.
 */
export function normaliseSettings(
  raw: string,
  original: RoleplaySettings,
): RoleplaySettings | null {
  const parsed = parseObject(raw ?? '');
  if (!parsed) return null;
  const out: RoleplaySettings = {};
  for (const [key, before] of Object.entries(original)) {
    const value = parsed[key];
    if (typeof before === 'boolean') {
      out[key] =
        typeof value === 'boolean'
          ? value
          : value === 'true'
            ? true
            : value === 'false'
              ? false
              : before;
    } else if (typeof before === 'number') {
      const n = typeof value === 'string' ? Number(value) : value;
      out[key] = typeof n === 'number' && Number.isFinite(n) ? n : before;
    } else {
      out[key] =
        typeof value === 'string' && value.trim() ? value.trim() : before;
    }
  }
  return out;
}
