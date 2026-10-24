import { describe, expect, it } from "vitest";

import { seedRatings } from "../useGuideJourney";

describe("seedRatings", () => {
  it("keeps the learner's earlier thumbs from bootstrap, marked as given before", () => {
    expect(
      seedRatings([{ id: "m1", myRating: 1 }, { id: "m2" }, { id: "m3", myRating: -1 }]),
    ).toEqual({
      m1: { rating: 1, status: "saved", seeded: true },
      m3: { rating: -1, status: "saved", seeded: true },
    });
  });

  it("ignores anything that isn't a thumb", () => {
    expect(seedRatings([{ id: "m1", myRating: 0 as unknown as 1 }])).toEqual({});
  });
});
