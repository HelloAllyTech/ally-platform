/** Studio's default box breathing (CreateTrack's DEFAULT_BREATHING_EXERCISE_CONTENT). */
export const DEFAULT_BREATHING_EXERCISE = {
  inhale: 4,
  holdIn: 4,
  exhale: 4,
  holdOut: 4,
  cycles: 4,
  inhaleText: 'Inhale',
  holdInText: 'Hold',
  exhaleText: 'Exhale',
  holdOutText: 'Hold',
};

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/**
 * Trigger warnings as ids the database accepts. The planner sometimes writes names or invented
 * labels ("suicidal-ideation-self-harm") instead of ids, and an unknown id fails the whole
 * roleplay. Real ids pass through; a name or label maps to every warning whose name it contains;
 * anything else is dropped.
 */
export function matchTriggerWarnings(
  raw: unknown[],
  warnings: { id: string; name: string }[],
): string[] {
  const known = new Set(warnings.map((w) => w.id));
  const ids = new Set<string>();
  for (const value of raw) {
    const token = String(value ?? '').trim();
    if (!token) continue;
    if (known.has(token)) {
      ids.add(token);
      continue;
    }
    const label = `-${slug(token)}-`;
    for (const warning of warnings) {
      const name = slug(warning.name);
      if (name && label.includes(`-${name}-`)) ids.add(warning.id);
    }
  }
  return [...ids];
}
