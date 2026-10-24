import { AllyGuideReleaseAuditRow } from "@types";

/** The wording for each kind of audit row. Passed in, so this module stays free of the copy barrel. */
export interface AuditWording {
  created: (version: number | null) => string;
  statusChanged: (version: number | null) => string;
  promoted: (to: number | null, from: number | null) => string;
  rolledBack: (to: number | null, from: number | null) => string;
  emergencyRollback: (to: number | null, from: number | null) => string;
  emergencyStop: string;
  note: string;
  canaryStarted: (version: number | null, percent: number | null) => string;
  canaryStopped: (version: number | null, emergency: boolean) => string;
  unknown: (action: string) => string;
}

const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/**
 * One audit row, in a sentence: what happened and to which version.
 *
 * `emergency` is true for anything that moved every conversation at its next turn (an emergency
 * rollback, or a canary stopped with `emergency`), so the table can set those apart in words.
 */
export const describeAudit = (
  row: AllyGuideReleaseAuditRow,
  wording: AuditWording,
): { text: string; emergency: boolean } => {
  const detail = row.detail ?? {};
  const version = row.version;
  switch (row.action) {
    case "created":
      return { text: wording.created(version), emergency: false };
    case "status_changed":
      return { text: wording.statusChanged(version), emergency: false };
    case "promoted":
      return {
        text: wording.promoted(num(detail.toVersion) ?? version, num(detail.fromVersion)),
        emergency: false,
      };
    case "rolled_back":
      return {
        text: wording.rolledBack(num(detail.toVersion) ?? version, num(detail.fromVersion)),
        emergency: false,
      };
    case "emergency_rollback":
      // Stopping a canary with `emergency` leaves the same marker, flagged `canaryStopped`.
      return detail.canaryStopped === true
        ? { text: wording.emergencyStop, emergency: true }
        : {
            text: wording.emergencyRollback(
              num(detail.toVersion) ?? version,
              num(detail.fromVersion),
            ),
            emergency: true,
          };
    case "note":
      return { text: wording.note, emergency: false };
    case "canary_started":
      return {
        text: wording.canaryStarted(num(detail.version) ?? version, num(detail.percent)),
        emergency: false,
      };
    case "canary_stopped": {
      const emergency = detail.emergency === true;
      return { text: wording.canaryStopped(num(detail.version) ?? version, emergency), emergency };
    }
    default:
      return { text: wording.unknown(String(row.action)), emergency: false };
  }
};

/** Who did it: their name, "the system" for a seed, "the curator", or an honest fallback. */
export const auditActor = (
  row: AllyGuideReleaseAuditRow,
  currentUserId: number | string | null | undefined,
  labels: {
    you: string;
    seed: string;
    curator: string;
    person: string;
    user: (id: number) => string;
  },
): string => {
  if (row.actorKind === "seed") return labels.seed;
  if (row.actorKind === "curator") return labels.curator;
  if (row.actorUserId === null || row.actorUserId === undefined) return labels.person;
  if (
    currentUserId !== null &&
    currentUserId !== undefined &&
    Number(currentUserId) === row.actorUserId
  ) {
    return labels.you;
  }
  return row.actorName?.trim() ? row.actorName.trim() : labels.user(row.actorUserId);
};
