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
