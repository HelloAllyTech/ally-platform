/**
 * Scenario-session events other modules listen for. Kept in their own file so
 * a listener (the Ally guide) can import the name without pulling in the
 * session service's dependency graph.
 */

/** A session's learner-facing debrief has been written (after commit). */
export const SCENARIO_SESSION_DEBRIEF_READY_EVENT =
  'scenario.session.debrief.ready';

export interface ScenarioSessionDebriefReadyEvent {
  scenarioSessionId: string;
  tenantId: string;
}

/**
 * Today's debrief finished writing a session whose organisation is switched
 * on for the Debrief agent (after commit). The agent's publish service puts
 * the live debrief's fields back if it landed first (v9 FR-4, FR-20).
 */
export const SCENARIO_SESSION_LEGACY_DEBRIEF_WRITTEN_EVENT =
  'scenario.session.legacy-debrief.written';

export interface ScenarioSessionLegacyDebriefWrittenEvent {
  scenarioSessionId: string;
  tenantId: string;
}
