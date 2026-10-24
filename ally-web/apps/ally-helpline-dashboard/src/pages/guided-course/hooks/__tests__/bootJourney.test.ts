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
  enroll: vi.fn().mockResolvedValue({ alreadyEnrolled: false }),
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
  it("enrols through the thread on first open, and only when not already enrolled", async () => {
    const d = deps({
      getBootstrap: vi.fn().mockResolvedValue({
        availability: { guided: true },
        access: { hasAccess: true, enrolled: false, reason: null },
        messages: [],
        cards: [],
      }),
    });
    const outcome = await bootJourney("c1", d);
    expect(d.enroll).toHaveBeenCalledWith("t1");
    expect(outcome.kind === "ready" && outcome.bootstrap.access.enrolled).toBe(true);

    const already = deps();
    await bootJourney("c1", already);
    expect(already.enroll).not.toHaveBeenCalled();
  });

  it("opens anyway when enrolment fails for a passing reason (Start retries it)", async () => {
    const d = deps({
      getBootstrap: vi.fn().mockResolvedValue({
        availability: { guided: true },
        access: { hasAccess: true, enrolled: false, reason: null },
      }),
      enroll: vi.fn().mockRejectedValue({ status: 500 }),
    });
    const outcome = await bootJourney("c1", d);
    expect(outcome.kind).toBe("ready");
    expect(outcome.kind === "ready" && outcome.bootstrap.access.enrolled).toBe(false);
  });

  describe("anonymous visitors (M2)", () => {
    const visitorWire = {
      availability: { guided: true, anonymousChat: true, voice: false, languages: ["en"] },
      access: { hasAccess: false, enrolled: false, reason: null },
      course: { id: "c1", title: "Course", languageCode: "en", estimatedMinutes: 20 },
      messages: [],
      cards: [],
      allowance: { remaining: 5, limit: 5 },
    };
    const visitor = (over: Partial<NonNullable<BootDeps["visitor"]>> = {}) => ({
      ensureToken: vi.fn().mockResolvedValue("tok"),
      dropToken: vi.fn(),
      getBootstrap: vi.fn().mockResolvedValue(visitorWire),
      ...over,
    });
    const signedOut = (v: NonNullable<BootDeps["visitor"]>, anonymousChat = true) =>
      deps({
        isSignedIn: () => false,
        getAvailability: vi.fn().mockResolvedValue({ guided: true, anonymousChat }),
        visitor: v,
      });

    it("opens a visitor's journey with their token, the preview and the allowance (no thread yet)", async () => {
      const v = visitor();
      const d = signedOut(v);
      const outcome = await bootJourney("c1", d);
      expect(outcome).toMatchObject({
        kind: "ready",
        identity: "visitor",
        visitorToken: "tok",
        bootstrap: { thread: null, allowance: { remaining: 5, limit: 5 } },
      });
      expect(v.getBootstrap).toHaveBeenCalledWith("c1", "tok");
      expect(d.openThread).not.toHaveBeenCalled();
      expect(d.getBootstrap).not.toHaveBeenCalled();
    });

    it("asks for sign-in when anonymous chat is off, or this address has too many visits", async () => {
      expect(await bootJourney("c1", signedOut(visitor(), false))).toEqual({ kind: "signed_out" });
      const busy = visitor({ ensureToken: vi.fn().mockRejectedValue(httpError(429)) });
      expect(await bootJourney("c1", signedOut(busy))).toEqual({ kind: "signed_out" });
    });

    it("drops a refused token and starts a new visit, once", async () => {
      const getBootstrap = vi
        .fn()
        .mockRejectedValueOnce(httpError(401, "GUIDE_VISITOR_INVALID"))
        .mockResolvedValueOnce(visitorWire);
      const v = visitor({ getBootstrap });
      expect(await bootJourney("c1", signedOut(v))).toMatchObject({ kind: "ready" });
      expect(v.dropToken).toHaveBeenCalledTimes(1);
      expect(v.ensureToken).toHaveBeenCalledTimes(2);

      const always = visitor({
        getBootstrap: vi.fn().mockRejectedValue(httpError(401, "GUIDE_VISITOR_INVALID")),
      });
      expect(await bootJourney("c1", signedOut(always))).toEqual({ kind: "error" });
    });

    it("signing in claims the visit once, then boots as the learner", async () => {
      const claim = {
        pendingToken: () => "tok",
        claimThread: vi.fn().mockResolvedValue({ ...thread, claim: "claimed" }),
        dropToken: vi.fn(),
      };
      const d = deps({ claim });
      const outcome = await bootJourney("c1", d);
      expect(outcome).toMatchObject({ kind: "ready", identity: "learner", claim: "claimed" });
      expect(claim.claimThread).toHaveBeenCalledWith("c1", "tok");
      expect(claim.dropToken).toHaveBeenCalled();
      // The claim is the thread call: bootstrap comes after it.
      expect(claim.claimThread.mock.invocationCallOrder[0]).toBeLessThan(
        (d.getBootstrap as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0],
      );
    });

    it("a refused claim keeps the visit and says why", async () => {
      const claim = {
        pendingToken: () => "tok",
        claimThread: vi.fn().mockRejectedValue(httpError(403, "GUIDE_NO_ACCESS")),
        dropToken: vi.fn(),
      };
      const outcome = await bootJourney(
        "c1",
        deps({
          claim,
          getAccess: vi.fn().mockResolvedValue({
            hasAccess: false,
            enrolled: false,
            reason: TrackAccessDenialReason.NOT_IN_ORGANIZATION,
          }),
        }),
      );
      expect(outcome).toEqual({
        kind: "denied",
        reason: TrackAccessDenialReason.NOT_IN_ORGANIZATION,
        claimRefused: true,
      });
      expect(claim.dropToken).not.toHaveBeenCalled();
    });

    it("an unknown token is dropped and the learner boots as usual", async () => {
      const claim = {
        pendingToken: () => "old",
        claimThread: vi.fn().mockRejectedValue(httpError(401, "GUIDE_VISITOR_INVALID")),
        dropToken: vi.fn(),
      };
      const outcome = await bootJourney("c1", deps({ claim }));
      expect(outcome).toMatchObject({ kind: "ready", identity: "learner" });
      expect(outcome).not.toHaveProperty("claim");
      expect(claim.dropToken).toHaveBeenCalled();
    });
  });
});
