import type { ConfigService } from '@nestjs/config';

/**
 * Kill switches for the assistants safety features (build rules: each risky feature defaults ON
 * and can be turned off by an environment variable, no deploy of code). Set the variable to
 * `false` or `0` to switch the feature off.
 */
export const SWITCHES = {
  /** The one-minute job's outbox drain and email/WhatsApp/Slack sending. Rows wait while off. */
  alertSending: 'ASSISTANT_ALERT_SENDING_ENABLED',
  /** The fixed holding and "no one is available" messages and the untaken-flag timer. */
  crisisJob: 'ASSISTANT_CRISIS_JOB_ENABLED',
  /** The crisis flag backfill over stored conversations. */
  crisisBackfill: 'ASSISTANT_CRISIS_BACKFILL_ENABLED',
  /** The staff deny guard on the platform routes (Defaults, Library, analytics). */
  staffGuard: 'STAFF_DENY_GUARD_ENABLED',
  /** Stage 8: Ally staff's read-only view of any chatbot (every read logged first). Off: 404. */
  staffView: 'ASSISTANT_STAFF_VIEW_ENABLED',
  /** Stage 5: the per-chatbot retention sweep (still blocked until the crisis backfill is done). */
  retentionSweep: 'ASSISTANT_RETENTION_SWEEP_ENABLED',
  /** Stage 5 (D7): the one-off deletion of memory stored before consent existed. */
  memoryCutover: 'ASSISTANT_MEMORY_CUTOVER_ENABLED',
  /** Stage 5: the personal-data scan that holds uploads for the owner's review. */
  knowledgePiiReview: 'ASSISTANT_KNOWLEDGE_PII_REVIEW_ENABLED',
  /** Stage 4: the go-live gate on publish, status change and the page toggle (D10). */
  goLiveGate: 'ASSISTANT_GO_LIVE_GATE_ENABLED',
  /** Stage 4 (D10): pausing live chatbots that fail the go-live gate. */
  unpublishBackfill: 'ASSISTANT_UNPUBLISH_BACKFILL_ENABLED',
  /** Stage 9: serve safety packs from their current release. Off: the code packs, as before. */
  packReleases: 'ASSISTANT_PACK_RELEASES_ENABLED',
} as const;

export function switchOn(
  config: Pick<ConfigService, 'get'> | undefined,
  name: (typeof SWITCHES)[keyof typeof SWITCHES],
): boolean {
  const raw = config?.get<string | boolean>(name);
  if (raw === undefined || raw === null || raw === '') return true;
  const text = String(raw).trim().toLowerCase();
  return !(text === 'false' || text === '0' || text === 'off');
}
