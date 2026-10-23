import { describe, expect, it, vi } from "vitest";

import { TrackAccessDenialReason, TrackDetail } from "@types";

import { BootDeps, bootJourney } from "../bootJourney";

const thread = {
  id: "t1",
  mode: "NORMAL" as const,
  atmosphere: "bright" as const,
  lastEventSeq: 0,
};
const httpError = (status: number, errorCode?: string) => ({
  status,
  data: errorCode ? { errorCode } : {},
});

const deps = (over: Partial<BootDeps> = {}): BootDeps => ({
  isSignedIn: () => true,
  getBootstrap: vi.fn().mockResolvedValue({
    availability: { guided: true },
    access: { hasAccess: true, enrolled: true, reason: null },
    thread: null,
    course: { title: "Course" },
  }),
  getAvailability: vi.fn().mockResolvedValue({ guided: true }),
  getAccess: vi.fn().mockResolvedValue({ hasAccess: true, enrolled: true, reason: null }),
  getDetail: vi
    .fn()
    .mockResolvedValue({ id: "c1", title: "Course", sections: [] } as unknown as TrackDetail),
  openThread: vi.fn().mockResolvedValue(thread),
  ...over,
});

describe("bootJourney", () => {
  it("uses bootstrap and creates the thread on first visit", async () => {
    const d = deps();
    const outcome = await bootJourney("c1", d);
    expect(outcome).toMatchObject({ kind: "ready", bootstrap: { thread, complete: true } });
    expect(d.openThread).toHaveBeenCalledWith("c1");
  });

  it("falls back to the pre-bootstrap endpoints when bootstrap 404s", async () => {
    const d = deps({ getBootstrap: vi.fn().mockRejectedValue(httpError(404)) });
    const outcome = await bootJourney("c1", d);
    expect(outcome).toMatchObject({ kind: "ready", bootstrap: { thread, complete: false } });
    expect(d.getAvailability).toHaveBeenCalled();
    expect(d.getDetail).toHaveBeenCalled();
  });

  it("is disabled when the guide is off (either path)", async () => {
    expect(
      await bootJourney(
        "c1",
        deps({ getBootstrap: vi.fn().mockRejectedValue(httpError(403, "GUIDE_DISABLED")) }),
      ),
    ).toEqual({ kind: "disabled" });
    expect(
      await bootJourney(
        "c1",
        deps({ getBootstrap: vi.fn().mockResolvedValue({ availability: { guided: false } }) }),
      ),
    ).toEqual({ kind: "disabled" });
    expect(
      await bootJourney(
        "c1",
        deps({
          getBootstrap: vi.fn().mockRejectedValue(httpError(404)),
          getAvailability: vi.fn().mockResolvedValue({ guided: false }),
        }),
      ),
    ).toEqual({ kind: "disabled" });
  });

  it("is denied with the classic access reason", async () => {
    const outcome = await bootJourney(
      "c1",
      deps({
        getBootstrap: vi.fn().mockRejectedValue(httpError(403, "GUIDE_NO_ACCESS")),
        getAccess: vi.fn().mockResolvedValue({
          hasAccess: false,
          enrolled: false,
          reason: TrackAccessDenialReason.NOT_IN_GROUP,
        }),
      }),
    );
    expect(outcome).toEqual({ kind: "denied", reason: "NOT_IN_GROUP" });
    const viaBootstrap = await bootJourney(
      "c1",
      deps({
        getBootstrap: vi.fn().mockResolvedValue({
          availability: { guided: true },
          access: { hasAccess: false, enrolled: false, reason: "NO_ORGANIZATION" },
        }),
      }),
    );
    expect(viaBootstrap).toEqual({ kind: "denied", reason: "NO_ORGANIZATION" });
  });

  it("refuses at thread creation the same way", async () => {
    const outcome = await bootJourney(
      "c1",
      deps({ openThread: vi.fn().mockRejectedValue(httpError(403, "GUIDE_DISABLED")) }),
    );
    expect(outcome).toEqual({ kind: "disabled" });
  });

  it("calls a missing course unavailable", async () => {
    const outcome = await bootJourney(
      "c1",
      deps({
        getBootstrap: vi.fn().mockRejectedValue(httpError(404)),
        getDetail: vi.fn().mockRejectedValue(httpError(404)),
      }),
    );
    expect(outcome).toEqual({ kind: "unavailable" });
  });

  it("asks a signed-out visitor to sign in only when the guide is on", async () => {
    expect(await bootJourney("c1", deps({ isSignedIn: () => false }))).toEqual({
      kind: "signed_out",
    });
    expect(
      await bootJourney(
        "c1",
        deps({
          isSignedIn: () => false,
          getAvailability: vi.fn().mockResolvedValue({ guided: false }),
        }),
      ),
    ).toEqual({ kind: "disabled" });
  });

  it("reports anything unexpected as an error (the page offers classic)", async () => {
    expect(
      await bootJourney("c1", deps({ getBootstrap: vi.fn().mockRejectedValue(httpError(500)) })),
    ).toEqual({ kind: "error" });
  });

  it("keeps the dial setting remembered on this device when the server has none", async () => {
    const outcome = await bootJourney("c1", deps({ localGuidance: () => "drive" }));
    expect(outcome.kind === "ready" && outcome.bootstrap.prefs.guidance).toBe("drive");
  });
});
