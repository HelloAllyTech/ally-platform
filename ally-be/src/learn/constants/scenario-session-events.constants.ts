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
