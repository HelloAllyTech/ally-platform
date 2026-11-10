import { DataSource } from 'typeorm';
import { DEBRIEF_AGENT_KEY } from '../constants/debrief-release.constants';

/**
 * The keys a published live debrief writes into `summary.feedback`
 * (DebriefPublishService). A feedback object holding only these was written
 * by the Debrief agent, not by today's debrief.
 */
export const DEBRIEF_AGENT_FEEDBACK_KEYS: ReadonlySet<string> = new Set([
  'supervisorNote',
  'positives',
  'improvements',
  'skillCoverage',
  'debriefGenerator',
]);

/**
 * True when today's debrief has written this feedback. Feedback without the
 * agent's stamp is always today's (the guard's old behaviour, unchanged);
 * stamped feedback is today's only if it holds a key the agent never writes.
 */
export function hasLegacyFeedback(
  feedback: Record<string, unknown> | null | undefined,
): boolean {
  if (!feedback) return false;
  if (!('debriefGenerator' in feedback)) return true;
  return Object.keys(feedback).some((k) => !DEBRIEF_AGENT_FEEDBACK_KEYS.has(k));
}

/**
 * Whether the session's organisation is switched on for the Debrief agent
 * (`agent_config_overrides`, layer `org`, key `live`). Read without the
 * debrief module so the session service can ask it without a circular
 * import. Fails to "not live": a read error must leave today's behaviour.
 */
export async function isDebriefAgentLiveForSession(
  dataSource: DataSource,
  scenarioSessionId: string,
): Promise<boolean> {
  try {
    const rows = await dataSource.query(
      `SELECT 1 FROM agent_config_overrides o
         JOIN scenario_sessions s ON s.tenant_id = o."scopeId"
        WHERE s.id = $1
          AND o."agentKey" = $2 AND o.layer = 'org'
          AND (o."values"->>'live')::boolean = true
        LIMIT 1`,
      [scenarioSessionId, DEBRIEF_AGENT_KEY],
    );
    return rows.length > 0;
  } catch {
    return false;
  }
}
