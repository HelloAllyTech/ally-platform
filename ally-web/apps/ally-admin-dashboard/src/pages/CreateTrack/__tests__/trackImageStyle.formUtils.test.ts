import { describe, expect, it } from "vitest";

import { TrackDetail, TrackFormValues } from "@types";

import { deserializeTrack, extractTrackMetadata } from "../trackFormUtils";

const form: TrackFormValues = {
  title: "Course",
  description: "",
  coverImageUrl: "",
  isGlobal: false,
  isPublicView: false,
  competencyIds: [],
  sections: [],
};

const detail = {
  id: "t1",
  title: "Course",
  description: "",
  coverImageUrl: "",
  status: "ACTIVE",
  isGlobal: false,
  totalItems: 0,
  sections: [],
} as unknown as TrackDetail;

describe("course visual style (imageStyleId / imageStyleAnchorId)", () => {
  it("is left out of the save until the form holds it, so an older backend never sees it", () => {
    const metadata = extractTrackMetadata(form);
    expect(metadata).not.toHaveProperty("imageStyleId");
    expect(metadata).not.toHaveProperty("imageStyleAnchorId");
  });

  it("is sent once set, and null clears it", () => {
    expect(
      extractTrackMetadata({ ...form, imageStyleId: "watercolour", imageStyleAnchorId: "a-1" }),
    ).toMatchObject({ imageStyleId: "watercolour", imageStyleAnchorId: "a-1" });
    expect(
      extractTrackMetadata({ ...form, imageStyleId: null, imageStyleAnchorId: null }),
    ).toMatchObject({ imageStyleId: null, imageStyleAnchorId: null });
  });

  it("loads from the course when the backend sends it", () => {
    const loaded = deserializeTrack({
      ...detail,
      imageStyleId: "line_art",
      imageStyleAnchorId: null,
    });
    expect(loaded.imageStyleId).toBe("line_art");
    expect(loaded.imageStyleAnchorId).toBeNull();
    expect(deserializeTrack(detail)).not.toHaveProperty("imageStyleId");
  });
});
