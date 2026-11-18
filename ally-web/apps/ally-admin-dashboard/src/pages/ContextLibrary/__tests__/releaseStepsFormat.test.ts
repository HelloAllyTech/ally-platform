import { describe, expect, it } from "vitest";

import type { ContextRolloutStep } from "@types";

import {
  formatMoment,
  releaseStepCounts,
  releaseStepLabel,
  releaseStepWhen,
} from "../releaseStepsFormat";

const step = (over: Partial<ContextRolloutStep> = {}): ContextRolloutStep => ({
  step: "retire",
  status: "pending",
  attempts: 0,
  startedAt: null,
  finishedAt: null,
  nextAttemptAt: null,
  lastError: null,
  detail: {},
  waitingUntil: null,
  ...over,
});

describe("releaseStepLabel", () => {
  it("names each step's state in plain words", () => {
    expect(releaseStepLabel(step({ step: "import", status: "running" }), 24)).toBe(
      "Importing character material",
    );
    expect(releaseStepLabel(step({ step: "enrich", status: "done" }), 24)).toBe(
      "Copied passages enriched",
    );
    expect(releaseStepLabel(step({ step: "smoke_check", status: "running" }), 24)).toBe(
      "Replaying recent searches",
    );
    expect(releaseStepLabel(step({ status: "done" }), 24)).toBe("Old corpus removed");
    expect(releaseStepLabel(step({ step: "import", status: "skipped" }), 24)).toBe(
      "No character material to import",
    );
  });

  it("says what a pending removal is waiting for", () => {
    expect(releaseStepLabel(step({ waitingUntil: "2026-11-11T09:00:00Z" }), 24)).toBe(
      "Waiting 24 h before removing the old corpus",
    );
    expect(releaseStepLabel(step({ waitingUntil: "2026-11-11T09:00:00Z" }), 1.5)).toBe(
      "Waiting 1.5 h before removing the old corpus",
    );
    expect(releaseStepLabel(step({ detail: { importable: 4, complete: 3 } }), 24)).toBe(
      "Waiting for every document to finish importing",
    );
    expect(releaseStepLabel(step({ detail: { activeChunks: 0 } }), 24)).toBe(
      "Waiting for the new collection to have an active entry",
    );
  });

  it("tells a corpus removed by hand from one this removed", () => {
    expect(releaseStepLabel(step({ status: "done", detail: { alreadyRetired: 1 } }), 24)).toBe(
      "Old corpus already removed by hand",
    );
  });
});

describe("releaseStepCounts", () => {
  it("counts each step's work", () => {
    expect(
      releaseStepCounts(
        step({ step: "import", detail: { importable: 5, complete: 2, withFailedParts: 1 } }),
      ),
    ).toBe("2 of 5 documents imported · 1 with failed parts");
    expect(releaseStepCounts(step({ step: "enrich", detail: { pending: 1 } }))).toBe(
      "1 passage still to enrich",
    );
    expect(
      releaseStepCounts(
        step({ step: "enrich", status: "done", detail: { pending: 0, passagesCopied: 80 } }),
      ),
    ).toBe("80 passages");
    expect(
      releaseStepCounts(
        step({ step: "smoke_check", detail: { replayed: 1, answered: 0, failed: 1 } }),
      ),
    ).toBe("0 of 1 search found a good answer · 1 could not be replayed");
    expect(
      releaseStepCounts(
        step({
          status: "done",
          detail: {
            documentsDeleted: 3,
            passagesDeleted: 10,
            filesDeleted: 3,
            retrievalLogsDeleted: 40,
          },
        }),
      ),
    ).toBe("3 documents, 10 passages, 3 files and 40 search logs removed");
    expect(releaseStepCounts(step({ detail: { activeChunks: 1 } }))).toBe(
      "1 active entry in the new collection",
    );
  });

  it("is empty before a step has counted anything", () => {
    expect(releaseStepCounts(step({ step: "smoke_check" }))).toBe("");
  });
});

describe("releaseStepWhen", () => {
  it("says when it finished, when it next tries, or that it stopped trying", () => {
    expect(releaseStepWhen(step({ status: "done", finishedAt: "2026-11-10T09:05:00Z" }), 8)).toBe(
      `Finished ${formatMoment("2026-11-10T09:05:00Z")}`,
    );
    expect(
      releaseStepWhen(step({ status: "failed", nextAttemptAt: "2026-11-10T10:00:00Z" }), 8),
    ).toBe(`Trying again ${formatMoment("2026-11-10T10:00:00Z")}`);
    expect(releaseStepWhen(step({ status: "failed", attempts: 8 }), 8)).toBe(
      "Stopped after 8 tries; run it by hand once the cause is fixed",
    );
    expect(releaseStepWhen(step(), 8)).toBe("");
  });

  it("formats a moment and ignores what is not one", () => {
    expect(formatMoment("not a date")).toBe("");
    expect(formatMoment(null)).toBe("");
  });
});
