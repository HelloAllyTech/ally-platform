import { randomUUID } from 'crypto';
import { SimulationState } from '../type/simulation-state.type';
import { validateSimulationStates } from './validate-simulation-states.util';

/** The narrowest band the Studio accepts (and the manual's "five net helpful behaviours" at ±10). */
export const MIN_STATE_BAND = 50;

export interface RoleplayStateDesign {
  /** Score points per positive state; at least MIN_STATE_BAND. Wider is harder (a difficulty dial). */
  bandWidth: number;
  /** The state entered when the score goes net negative. */
  rupture: { name: string; guidelines: string };
}

/**
 * Lay generated states out the way the Course Design Manual asks: a rupture state below 0, the
 * opening state from 0, and each further positive state one band higher, with no gaps.
 *
 * `positive` is in order from the opening state to the most open one (what the states generator
 * returns; its own score bounds are ignored). Returns [] when there is nothing usable or the
 * layout would fail the Studio's own validation, so a caller never saves an invalid set.
 */
export function layOutRoleplayStates(
  positive: Pick<SimulationState, 'name' | 'guidelines' | 'ragEnabled'>[],
  design: RoleplayStateDesign,
): SimulationState[] {
  const width = Math.max(MIN_STATE_BAND, Math.round(design.bandWidth || 0));
  const usable = (positive ?? []).filter(
    (s) => s?.name?.trim() && s?.guidelines?.trim(),
  );
  if (!usable.length) return [];

  const states: SimulationState[] = [
    {
      id: randomUUID(),
      name: design.rupture.name,
      guidelines: design.rupture.guidelines,
      // Wide enough that a run of unhelpful turns stays in rupture; scores below it clamp here.
      scoreLower: -2 * width,
      scoreUpper: 0,
      ragEnabled: false,
    },
    ...usable.map((s, index) => ({
      id: randomUUID(),
      name: s.name.trim(),
      guidelines: s.guidelines.trim(),
      scoreLower: index * width,
      scoreUpper: (index + 1) * width,
      ragEnabled: s.ragEnabled !== false,
    })),
  ];
  return validateSimulationStates(states).length === 0 ? states : [];
}

/** What a built roleplay looks like to the checks below. */
export interface BuiltRoleplayShape {
  title?: string;
  prompt?: string;
  competencyId?: string;
  /** Language id → voice id (the create DTO's shape); a list is accepted too. */
  languageVoices?: unknown;
  openingStatements?: unknown;
  /** Opening lines for languages other than the primary one, by language id. */
  translationOpeningStatements?: Record<string, unknown>;
  reminders?: unknown;
  remindersEnabled?: boolean;
  states?: SimulationState[];
  selectedMainPromptCode?: string;
  experienceMode?: string;
}

/**
 * The roleplay agent's validator: problems found before the roleplay is saved. `fixable` ones the
 * caller repairs in place (see repairBuiltRoleplay); the rest are reported, never silently dropped.
 */
export function checkBuiltRoleplay(dto: BuiltRoleplayShape): {
  fixable: string[];
  reported: string[];
} {
  const fixable: string[] = [];
  const reported: string[] = [];
  if (!dto.title?.trim()) reported.push('no title');
  if (!dto.prompt?.trim()) reported.push('no role instruction');
  if (!dto.competencyId) reported.push('no competency');
  const voices = dto.languageVoices;
  const hasVoice = Array.isArray(voices)
    ? voices.length > 0
    : Boolean(voices) && typeof voices === 'object'
      ? Object.keys(voices as object).length > 0
      : false;
  if (!hasVoice) reported.push('no voiced language');
  const nonEmpty = (value: unknown) =>
    Array.isArray(value) ? value.length > 0 : Boolean(value);
  // The primary language's lines sit on openingStatements; any other language's on
  // translationOpeningStatements, so a roleplay in only English (US) has lines only there.
  const hasOpening =
    nonEmpty(dto.openingStatements) ||
    Object.values(dto.translationOpeningStatements ?? {}).some(nonEmpty);
  if (!hasOpening) reported.push('no opening lines');

  const hasReminders = Array.isArray(dto.reminders)
    ? dto.reminders.length > 0
    : Boolean(dto.reminders);
  if (dto.remindersEnabled && !hasReminders) fixable.push('reminders_empty');

  if (dto.states?.length) {
    if (validateSimulationStates(dto.states).length)
      fixable.push('states_invalid');
    if (!dto.selectedMainPromptCode) fixable.push('states_without_prompt');
    if (!dto.states.some((s) => (s.scoreUpper ?? 0) <= 0)) {
      reported.push('no rupture state');
    }
  }
  return { fixable, reported };
}

/** Repair what checkBuiltRoleplay marked fixable; returns what was changed, in words. */
export function repairBuiltRoleplay<T extends BuiltRoleplayShape>(
  dto: T,
  fixable: string[],
): string[] {
  const changed: string[] = [];
  if (fixable.includes('reminders_empty')) {
    dto.remindersEnabled = false;
    changed.push('reminders hidden (none were written)');
  }
  if (
    fixable.includes('states_invalid') ||
    fixable.includes('states_without_prompt')
  ) {
    // States only run on a main prompt that reads them; without one they would be dead weight.
    dto.states = [];
    changed.push(
      'states dropped (no valid layout or no states-aware main prompt)',
    );
  }
  return changed;
}
