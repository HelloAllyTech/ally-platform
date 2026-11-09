import { describe, expect, it } from "vitest";

import type { ContextQueueItem } from "@types";

import {
  DockRow,
  dockStage,
  dockSummary,
  outcomeStage,
  phaseForResult,
  placeInLine,
} from "../upload/dockFormat";
import { matchResults } from "../upload/uploadStore";

const nouns = (id: string) =>
  id === "character_insights"
    ? { noun: "insight", nounPlural: "insights" }
    : { noun: "principle", nounPlural: "principles" };

const row = (over: Partial<DockRow> = {}): DockRow => ({
  id: "r1",
  batchId: "b1",
  fileName: "guide.pdf",
  title: "guide",
  collections: ["first_principles"],
  phase: "queued",
  uploadFraction: 1,
  sourceId: "s1",
  queuedAt: 1,
  ...over,
});

const item = (over: Partial<ContextQueueItem> = {}): ContextQueueItem => ({
  id: "s1",
  title: "Guide",
  status: "queued",
  targetCollections: ["first_principles"],
  partsTotal: 10,
  partsDone: 0,
  partsFailed: 0,
  costUsd: 0,
  costCapUsd: null,
  error: null,
  queuePosition: "1",
  ...over,
});

describe("dockStage: one plain label per stage", () => {
  it("uploading shows the upload progress, then Reading while the server parses", () => {
    expect(dockStage(row({ phase: "uploading", uploadFraction: 0.4 }), [], nouns)).toMatchObject({
      label: "Uploading",
      progress: 0.4,
      actions: [],
    });
    expect(dockStage(row({ phase: "reading" }), [], nouns).label).toBe("Reading");
  });

  it("waiting says its place in line, counting only waiting documents ahead", () => {
    const queue = [
      item({ id: "a", status: "extracting" }),
      item({ id: "b", status: "queued" }),
      item({ id: "c", status: "paused" }),
      item({ id: "s1", status: "queued" }),
    ];
    expect(placeInLine(queue, "s1")).toBe(2);
    const stage = dockStage(row(), queue, nouns);
    expect(stage.label).toBe("Waiting (2nd in line)");
    expect(stage.actions).toEqual(["pause", "cancel", "front"]);
  });

  it("first in line cannot move up", () => {
    expect(dockStage(row(), [item()], nouns).actions).toEqual(["pause", "cancel"]);
  });

  it("extracting counts parts and fills the bar from them", () => {
    const stage = dockStage(
      row(),
      [item({ status: "extracting", partsDone: 3, partsTotal: 12 })],
      nouns,
    );
    expect(stage.label).toBe("Extracting (3 of 12 parts)");
    expect(stage.progress).toBe(0.25);
    expect(stage.tone).toBe("active");
  });

  it("failed parts warn and offer Retry", () => {
    const stage = dockStage(
      row(),
      [item({ status: "extracting", partsDone: 5, partsTotal: 10, partsFailed: 2 })],
      nouns,
    );
    expect(stage.tone).toBe("warning");
    expect(stage.actions).toContain("retry");
    expect(stage.note).toBe("2 parts failed");
  });

  it("consolidating reads as Finishing up", () => {
    expect(dockStage(row(), [item({ status: "consolidating" })], nouns).label).toBe("Finishing up");
  });

  it("a cost-cap pause offers Continue and Stop", () => {
    const stage = dockStage(
      row(),
      [item({ status: "paused", error: "cost_cap", costUsd: 1.5, costCapUsd: 1.5 })],
      nouns,
    );
    expect(stage.label).toBe("Paused at its cost cap ($1.50 of $1.50)");
    expect(stage.actions).toEqual(["continue", "stop"]);
  });

  it("an ordinary pause offers Resume", () => {
    expect(dockStage(row(), [item({ status: "paused" })], nouns).actions).toEqual([
      "resume",
      "cancel",
    ]);
  });

  it("finished says what was added, in each collection's noun", () => {
    const done = row({
      phase: "finished",
      collections: ["first_principles", "character_insights"],
      final: {
        status: "complete",
        addedByCollection: { first_principles: 23, character_insights: 1 },
      },
    });
    expect(dockStage(done, [], nouns)).toMatchObject({
      label: "23 principles added · 1 insight added",
      tone: "done",
      progress: 1,
    });
  });

  it("a failed document offers Retry, a cancelled one only Dismiss", () => {
    expect(
      dockStage(
        row({ phase: "finished", final: { status: "failed", addedByCollection: {} } }),
        [],
        nouns,
      ).actions,
    ).toEqual(["retry", "dismiss"]);
    expect(
      dockStage(
        row({ phase: "finished", final: { status: "cancelled", addedByCollection: {} } }),
        [],
        nouns,
      ).label,
    ).toBe("Cancelled");
  });

  it("during the cancel's undo window only Undo is offered", () => {
    expect(dockStage(row({ cancelling: true }), [item()], nouns)).toMatchObject({
      label: "Cancelling…",
      actions: ["undoCancel"],
    });
  });

  it("warns when a document would start after its text expires", () => {
    expect(dockStage(row({ outlivesTtl: true }), [item()], nouns).note).toMatch(/24 hours/);
  });
});

describe("outcomeStage: what the server did not queue, and the choices", () => {
  it.each([
    ["already_in_collection", ["skip", "reextract"]],
    ["same_title", ["skip", "addAnyway"]],
    ["no_text", ["remove"]],
    ["failed", ["retryUpload", "dismiss"]],
    ["duplicate_in_drop", ["dismiss"]],
    ["unsupported", ["dismiss"]],
    ["too_large", ["dismiss"]],
  ] as const)("%s → %j", (outcome, actions) => {
    expect(outcomeStage(outcome).actions).toEqual(actions);
  });

  it("the default is already applied, and the label says so", () => {
    expect(outcomeStage("already_in_collection").label).toBe(
      "Already in this collection, so it was skipped",
    );
  });

  it("only a queued result follows the queue", () => {
    expect(phaseForResult({ fileName: "a.pdf", outcome: "queued" })).toBe("queued");
    expect(phaseForResult({ fileName: "a.pdf", outcome: "same_title" })).toBe("exception");
  });
});

describe("dockSummary", () => {
  it("counts documents, estimates time left and titles the tab", () => {
    const rows = [
      row({ id: "1", sourceId: "s1" }),
      row({ id: "2", sourceId: "s2" }),
      row({ id: "3", phase: "finished", final: { status: "complete", addedByCollection: {} } }),
      row({ id: "4", phase: "exception", outcome: "same_title" }),
    ];
    const queue = [
      item({ id: "s1", status: "extracting", partsTotal: 10, partsDone: 4 }),
      item({ id: "s2", partsTotal: 6 }),
    ];
    const summary = dockSummary(rows, queue);
    // 12 parts × 45s ÷ 3 workers = 3 minutes.
    expect(summary.headline).toBe("Adding 3 documents · about 3 min left");
    expect(summary.tabTitle).toBe("(1/3) Context Library");
    expect(summary.inFlight).toBe(false);
    expect(summary.safeToClose).toBe(true);
  });

  it("is not safe to close while bytes are going up", () => {
    const summary = dockSummary([row({ phase: "uploading", uploadFraction: 0.2 })], []);
    expect(summary.inFlight).toBe(true);
    expect(summary.safeToClose).toBe(false);
    expect(summary.headline).toBe("Adding 1 document");
  });

  it("says Added once nothing is active, and stops titling the tab", () => {
    const summary = dockSummary(
      [row({ phase: "finished", final: { status: "complete", addedByCollection: {} } })],
      [],
    );
    expect(summary.headline).toBe("Added 1 document");
    expect(summary.tabTitle).toBeNull();
  });
});

describe("matchResults", () => {
  it("pairs results to rows by file name, in order, for repeated names", () => {
    const matched = matchResults(
      [
        { id: "r1", fileName: "a.pdf" },
        { id: "r2", fileName: "a.pdf" },
        { id: "r3", fileName: "b.epub" },
      ],
      [
        { fileName: "b.epub", outcome: "queued" },
        { fileName: "a.pdf", outcome: "queued" },
        { fileName: "a.pdf", outcome: "duplicate_in_drop" },
      ],
    );
    expect(matched.get("r1")?.outcome).toBe("queued");
    expect(matched.get("r2")?.outcome).toBe("duplicate_in_drop");
    expect(matched.get("r3")?.outcome).toBe("queued");
  });
});
