import { FC } from "react";

import { en } from "@constants";
import { BugFindingDetail, BugFindingStatus } from "@types";
import { formatTimestamp } from "@utils";

import { BUG_HUNT_EVENT_STAGE_LABELS } from "./bugHuntEventLabels";

interface WorkLogEntry {
  id: string;
  at: string;
  /** The stage for a pipeline event; the person's name for something a person did. */
  label: string;
  summary: string;
  byPerson: boolean;
}

const nameOr = (name: string | null | undefined) => name || en.bugHunter.drawerAuditSomeone;

/**
 * The people in this bug's history: who approved or turned it down, who
 * answered its question, who released it and who stopped a session.
 *
 * These used to be four separate "Decided by user #7" lines under the actions,
 * each a raw id. As work-log lines with a name, at the time they happened, they
 * read in order with everything Bug Hunter did around them. A line is only
 * written when its timestamp is known — an entry with no time has nowhere true
 * to sit in a chronological log.
 */
export const auditEntries = (finding: BugFindingDetail): WorkLogEntry[] => {
  const entries: WorkLogEntry[] = [];
  if (finding.decidedBy != null && finding.decidedAt) {
    const declined =
      finding.decisionReason != null ||
      finding.status === BugFindingStatus.REJECTED ||
      finding.status === BugFindingStatus.DISMISSED;
    entries.push({
      id: "audit-decided",
      at: finding.decidedAt,
      label: nameOr(finding.decidedByName),
      summary: declined ? en.bugHunter.drawerAuditDeclined : en.bugHunter.drawerAuditApproved,
      byPerson: true,
    });
  }
  if (finding.escalationAnsweredBy != null && finding.escalationAnsweredAt) {
    entries.push({
      id: "audit-answered",
      at: finding.escalationAnsweredAt,
      label: nameOr(finding.escalationAnsweredByName),
      summary: en.bugHunter.drawerAuditAnswered.replace("{answer}", finding.escalationAnswer ?? ""),
      byPerson: true,
    });
  }
  if (finding.cancelledBy != null && finding.cancelledAt) {
    entries.push({
      id: "audit-cancelled",
      at: finding.cancelledAt,
      label: nameOr(finding.cancelledByName),
      summary: en.bugHunter.drawerAuditStopped,
      byPerson: true,
    });
  }
  if (finding.releasedBy != null && finding.releasedAt) {
    entries.push({
      id: "audit-released",
      at: finding.releasedAt,
      label: nameOr(finding.releasedByName),
      summary: en.bugHunter.drawerAuditReleased,
      byPerson: true,
    });
  }
  return entries;
};

/** Every line of the work log, oldest first: Bug Hunter's events and the people's actions together. */
export const workLogEntries = (finding: BugFindingDetail): WorkLogEntry[] => {
  // Defaulted rather than read straight off the response: a backend one
  // release behind this build omits `events`, and an absent list means the
  // same as an empty one.
  const events = (finding.events ?? []).map(event => ({
    id: event.id,
    at: event.createdAt,
    label: BUG_HUNT_EVENT_STAGE_LABELS[event.stage],
    summary: event.summary,
    byPerson: false,
  }));
  return [...events, ...auditEntries(finding)].sort(
    (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime(),
  );
};

/** "My work log": the timeline, with who-did-what merged in at the time it happened. */
export const FindingWorkLog: FC<{ entries: WorkLogEntry[] }> = ({ entries }) =>
  entries.length === 0 ? (
    <p className="text-sm text-typography-500">{en.bugHunter.drawerTimelineEmpty}</p>
  ) : (
    <ul data-testid="work-log" className="flex flex-col gap-1">
      {entries.map(entry => (
        <li
          key={entry.id}
          className="text-sm text-typography-800 flex flex-wrap gap-x-2 md:flex-nowrap md:gap-2"
        >
          <span className="text-typography-500 whitespace-nowrap tabular-nums">
            {formatTimestamp(entry.at)}
          </span>
          <span
            className={`font-medium whitespace-nowrap ${
              entry.byPerson ? "text-primary-700" : "text-typography-700"
            }`}
          >
            {entry.label}
          </span>
          <span className="min-w-0 break-words">{entry.summary}</span>
        </li>
      ))}
    </ul>
  );
