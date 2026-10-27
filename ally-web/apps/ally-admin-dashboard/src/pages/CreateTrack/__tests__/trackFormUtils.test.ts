import { describe, expect, it } from "vitest";

import { TrackItemType } from "@types";

import {
  createItemOfType,
  deserializeTrack,
  extractTrackMetadata,
  serializeItem,
  validateTrackForPublish,
} from "../trackFormUtils";

describe("serializeItem — ARTICLE resources", () => {
  it("includes resources in the saved content payload", () => {
    const item = createItemOfType(TrackItemType.ARTICLE);
    item.article = {
      html: "<p>Read this.</p>",
      questions: [],
      resources: [{ id: "r1", title: "A curated reading", url: "https://example.com/reading" }],
    };

    const payload = serializeItem(item, 1);

    expect(payload.content).toMatchObject({
      resources: [{ id: "r1", title: "A curated reading", url: "https://example.com/reading" }],
    });
  });

  it("omits the resources key entirely when there are none, like questions/imageUrls", () => {
    const item = createItemOfType(TrackItemType.ARTICLE);
    item.article = { html: "<p>hi</p>", questions: [] };

    const payload = serializeItem(item, 1);

    expect(payload.content).not.toHaveProperty("resources");
  });
});

describe("serializeItem — ROLEPLAY assessment mode", () => {
  it("sends assessmentMode when it is on", () => {
    const item = createItemOfType(TrackItemType.ROLEPLAY);
    item.scenarioId = 12;
    item.completionCriteria = { minScore: 40, assessmentMode: true };

    expect(serializeItem(item, 1).completionCriteria).toEqual({
      minScore: 40,
      assessmentMode: true,
    });
  });

  it("leaves it out when off, so the stored criteria read the same as before", () => {
    const item = createItemOfType(TrackItemType.ROLEPLAY);
    item.scenarioId = 12;
    item.completionCriteria = { minScore: 40, assessmentMode: false };

    expect(serializeItem(item, 1).completionCriteria).toEqual({ minScore: 40 });
  });
});

describe("validateTrackForPublish — ARTICLE resources", () => {
  const baseValues = (article: Record<string, unknown>) => ({
    title: "Course",
    description: "d",
    coverImageUrl: "https://example.com/cover.png",
    isGlobal: false,
    sections: [
      {
        localId: "s1",
        title: "Section",
        description: "",
        items: [
          {
            localId: "i1",
            type: TrackItemType.ARTICLE,
            title: "Article",
            description: "",
            completionCriteria: {},
            article,
          },
        ],
      },
    ],
  });

  it("accepts an article with valid resources", () => {
    const errors = validateTrackForPublish(
      baseValues({
        html: "<p>hi</p>",
        questions: [],
        resources: [{ id: "r1", title: "Reading", url: "https://example.com/x" }],
      }) as any,
    );
    expect(errors.filter(e => e.message.includes("resource"))).toEqual([]);
  });

  it("flags a resource missing a title", () => {
    const errors = validateTrackForPublish(
      baseValues({
        html: "<p>hi</p>",
        questions: [],
        resources: [{ id: "r1", title: "  ", url: "https://example.com/x" }],
      }) as any,
    );
    expect(errors.some(e => e.message.includes("title is required"))).toBe(true);
  });

  it("flags a non-http(s) resource URL", () => {
    const errors = validateTrackForPublish(
      baseValues({
        html: "<p>hi</p>",
        questions: [],
        resources: [{ id: "r1", title: "Reading", url: "javascript:alert(1)" }],
      }) as any,
    );
    expect(errors.some(e => e.message.includes("valid http(s) link"))).toBe(true);
  });

  it("caps the number of resources", () => {
    const resources = Array.from({ length: 11 }, (_, i) => ({
      id: `r${i}`,
      title: `Reading ${i}`,
      url: "https://example.com/x",
    }));
    const errors = validateTrackForPublish(
      baseValues({ html: "<p>hi</p>", questions: [], resources }) as any,
    );
    expect(errors.some(e => e.message.includes("at most 10 resources"))).toBe(true);
  });
});

describe("public view (isPublicView)", () => {
  const form = {
    title: "Course",
    description: "",
    coverImageUrl: "",
    isGlobal: false,
    isPublicView: true,
    competencyIds: [],
    sections: [],
  };

  it("is sent on every metadata save, so switching it off reaches the server", () => {
    expect(extractTrackMetadata(form).isPublicView).toBe(true);
    expect(extractTrackMetadata({ ...form, isPublicView: false }).isPublicView).toBe(false);
  });

  it("loads from the course, and reads as off when an older backend omits it", () => {
    const detail = {
      id: "t1",
      title: "Course",
      description: "",
      coverImageUrl: "",
      status: "ACTIVE",
      isGlobal: false,
      totalItems: 0,
      sections: [],
    } as any;

    expect(deserializeTrack({ ...detail, isPublicView: true }).isPublicView).toBe(true);
    expect(deserializeTrack(detail).isPublicView).toBe(false);
  });
});
