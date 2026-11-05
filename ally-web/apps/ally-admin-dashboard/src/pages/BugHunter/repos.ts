/**
 * The four repos Bug Hunter works on. Mirrors ally-be's `BUG_HUNT_REPOS`, which
 * remains the authority — it rejects anything not in its own map, so a drift
 * here surfaces as a clear 400 rather than a silent misfire. Held as a literal
 * rather than fetched because it changes about once a year.
 *
 * Lived in `SweepPanel` until the on-demand sweep control came off the page
 * (2026-10-01, sweeps are scheduled only); the notebook's repo filter is what
 * still needs it.
 *
 * 'ally-mobile' has no entry since the 2026-11 Flutter rename: it held RN's
 * npm/Jest commands, which are wrong for the Flutter code now at that path,
 * and there's no Flutter equivalent configured yet pending a deliberate
 * review of running Bug Hunter against it — see ally-be's own comment on
 * BUG_HUNT_REPOS.
 */
export const BUG_HUNTER_REPOS = [
  "ally-be",
  "ally-web",
  "ally-ai",
  "ally-ai-learn",
] as const;
