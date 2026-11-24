import type { RoleplayMode } from "../api/agentBuilder";

/**
 * A plan's states laid out the way ally-be's layOutRoleplayStates does (src/learn/util/
 * roleplay-design.util.ts): a rupture state below 0, then one band per state from 0, wider for
 * harder modes. Kept in step with that file; the Studio validator still checks the result on save.
 */
const BAND_BY_MODE: Record<RoleplayMode, number> = {
  learning: 50,
  practice: 70,
  performance: 100,
  pre_assessment: 100,
  post_assessment: 100,
};

const RUPTURE = {
  name: "Pulling away",
  guidelines:
    "You feel judged, rushed or not listened to. Give shorter answers, change the subject or say " +
    "you should go. Open up again only if the helper slows down, acknowledges what went wrong " +
    "and listens.",
};

const uid = () =>
  globalThis.crypto?.randomUUID?.() ?? `st_${Date.now()}_${Math.random().toString(36).slice(2)}`;

export const layOutPlanStates = (
  states: { name: string; guidelines: string }[],
  mode: RoleplayMode,
) => {
  const width = BAND_BY_MODE[mode] ?? 70;
  const usable = states.filter(s => s.name?.trim() && s.guidelines?.trim());
  if (!usable.length) return [];
  return [
    { id: uid(), ...RUPTURE, scoreLower: -2 * width, scoreUpper: 0, ragEnabled: false },
    ...usable.map((s, index) => ({
      id: uid(),
      name: s.name.trim(),
      guidelines: s.guidelines.trim(),
      scoreLower: index * width,
      scoreUpper: (index + 1) * width,
      ragEnabled: true,
    })),
  ];
};
