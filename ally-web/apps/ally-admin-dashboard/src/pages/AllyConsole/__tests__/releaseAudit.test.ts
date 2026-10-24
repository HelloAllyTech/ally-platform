import { describe, expect, it } from "vitest";

import { AllyGuideReleaseAuditRow } from "@types";

import { auditActor, AuditWording, describeAudit } from "../releaseAudit";

const wording: AuditWording = {
  created: v => `Created v${v}`,
  statusChanged: v => `Status of v${v} changed`,
  promoted: (to, from) => (from ? `Promoted v${to}, replacing v${from}` : `Promoted v${to}`),
  rolledBack: (to, from) => `Rolled back to v${to} from v${from}`,
  emergencyRollback: (to, from) => `Emergency rollback to v${to} from v${from}`,
  emergencyStop: "Emergency stop: every conversation moved to the live release",
  note: "Note added",
  canaryStarted: (v, percent) => `Canary v${v} started at ${percent}%`,
  canaryStopped: (v, emergency) => `Canary v${v} stopped${emergency ? " (emergency)" : ""}`,
  unknown: action => `Unrecognised change: ${action}`,
};

const row = (overrides: Partial<AllyGuideReleaseAuditRow> = {}): AllyGuideReleaseAuditRow => ({
  id: "a1",
  action: "promoted",
  releaseId: "rel-3",
  version: 3,
  actorKind: "human",
  actorUserId: 9,
  actorName: "Priya Nair",
  reason: null,
  detail: {},
  createdAt: "2026-10-23T10:00:00.000Z",
  ...overrides,
});

describe("describeAudit", () => {
  it("says a release was created", () => {
    expect(describeAudit(row({ action: "created", version: 4 }), wording)).toEqual({
      text: "Created v4",
      emergency: false,
    });
  });

  it("says what a promotion replaced, using the versions the server recorded", () => {
    expect(
      describeAudit(row({ action: "promoted", detail: { fromVersion: 2, toVersion: 3 } }), wording)
        .text,
    ).toBe("Promoted v3, replacing v2");
  });

  it("copes with a first promotion that replaced nothing", () => {
    expect(describeAudit(row({ action: "promoted", detail: {} }), wording).text).toBe(
      "Promoted v3",
    );
  });

  it("says a rollback went back, and is not an emergency unless it was one", () => {
    expect(
      describeAudit(
        row({ action: "rolled_back", detail: { fromVersion: 3, toVersion: 2 } }),
        wording,
      ),
    ).toEqual({ text: "Rolled back to v2 from v3", emergency: false });
    expect(
      describeAudit(
        row({ action: "emergency_rollback", detail: { fromVersion: 3, toVersion: 2 } }),
        wording,
      ),
    ).toEqual({ text: "Emergency rollback to v2 from v3", emergency: true });
  });

  it("reads the marker an emergency canary stop leaves as an emergency stop, not a rollback", () => {
    expect(
      describeAudit(
        row({ action: "emergency_rollback", detail: { canaryStopped: true } }),
        wording,
      ),
    ).toEqual({
      text: "Emergency stop: every conversation moved to the live release",
      emergency: true,
    });
  });

  it("says a canary started and at what share", () => {
    expect(
      describeAudit(
        row({ action: "canary_started", version: 5, detail: { version: 5, percent: 20 } }),
        wording,
      ).text,
    ).toBe("Canary v5 started at 20%");
  });

  it("says a canary stopped, and flags it when it was an emergency stop", () => {
    expect(
      describeAudit(
        row({ action: "canary_stopped", detail: { version: 5, emergency: false } }),
        wording,
      ),
    ).toEqual({ text: "Canary v5 stopped", emergency: false });
    expect(
      describeAudit(
        row({ action: "canary_stopped", detail: { version: 5, emergency: true } }),
        wording,
      ),
    ).toEqual({ text: "Canary v5 stopped (emergency)", emergency: true });
  });

  it("falls back to the joined version when the detail has none", () => {
    expect(
      describeAudit(row({ action: "canary_started", version: 6, detail: { percent: 10 } }), wording)
        .text,
    ).toBe("Canary v6 started at 10%");
  });

  it("does not choke on an action it has never heard of", () => {
    expect(
      describeAudit(row({ action: "teleported" as AllyGuideReleaseAuditRow["action"] }), wording),
    ).toEqual({ text: "Unrecognised change: teleported", emergency: false });
  });

  it("ignores a detail value that is not a number", () => {
    expect(
      describeAudit(
        row({ action: "promoted", detail: { fromVersion: "two", toVersion: null } }),
        wording,
      ).text,
    ).toBe("Promoted v3");
  });
});

describe("auditActor", () => {
  const labels = {
    you: "you",
    seed: "The system",
    curator: "The curator",
    person: "A person",
    user: (id: number) => `user ${id}`,
  };

  it("names the person, and says 'you' for the signed-in admin", () => {
    expect(auditActor(row(), 5, labels)).toBe("Priya Nair");
    expect(auditActor(row({ actorUserId: 5 }), 5, labels)).toBe("you");
  });

  it("falls back to the id, then to 'a person', when there is no name", () => {
    expect(auditActor(row({ actorName: null }), 5, labels)).toBe("user 9");
    expect(auditActor(row({ actorName: null, actorUserId: null }), 5, labels)).toBe("A person");
  });

  it("names the system for a seed and the curator for the curator, whatever ids are on the row", () => {
    expect(auditActor(row({ actorKind: "seed", actorUserId: null }), 5, labels)).toBe("The system");
    expect(auditActor(row({ actorKind: "curator", actorUserId: null }), 5, labels)).toBe(
      "The curator",
    );
  });
});
