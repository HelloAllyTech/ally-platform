import { describe, expect, it } from "vitest";

import { CONTEXT } from "../chartScales";
import {
  MAX_VOTER_BANDS,
  OTHER_ADMINS,
  RoadmapVoter,
  RoadmapVotingMonth,
  RoadmapVotingResponse,
  accessNote,
  buildRoadmapVotingScale,
  buildRoadmapVotingSeries,
  buildRoadmapVotingTable,
  buildWhoVotedGrid,
  participationLabel,
  roadmapVotingEmptyText,
  roadmapVotingTakeaway,
  voterBands,
} from "../roadmapVotingChart";

const voter = (userId: number, name: string, votes: number, hasAccessNow = true): RoadmapVoter => ({
  userId,
  name,
  votes,
  monthsVoted: votes > 0 ? 1 : 0,
  lastVotedMonth: null,
  hasAccessNow,
});

const month = (
  m: string,
  users: [number, number, number | null][],
  { partial = false, recorded = true } = {},
): RoadmapVotingMonth => ({
  month: m,
  partial,
  votes: users.reduce((s, [, v]) => s + v, 0),
  voters: users.filter(([, v]) => v > 0).length,
  eligible: recorded ? users.length : null,
  granted: recorded ? users.reduce((s, [, , g]) => s + (g ?? 0), 0) : null,
  users: users.map(([userId, votes, granted]) => ({ userId, votes, granted })),
});

const response = (
  months: RoadmapVotingMonth[],
  users: RoadmapVoter[],
  accessRecordedFrom: string | null = "2026-09-01",
): RoadmapVotingResponse => ({
  months,
  users,
  accessRecordedFrom,
  computedAt: "2026-11-03T00:00:00Z",
});

describe("voterBands", () => {
  it("gives every voter a band and none to admins who never voted", () => {
    const data = response([], [voter(1, "Asha", 9), voter(2, "Bea", 3), voter(3, "Cy", 0)]);
    expect(voterBands(data)).toEqual(["Asha", "Bea"]);
  });

  it("rolls the tail past the cap into Other admins", () => {
    const users = Array.from({ length: MAX_VOTER_BANDS + 2 }, (_, i) =>
      voter(i + 1, `U${i + 1}`, 100 - i),
    );
    const bands = voterBands(response([], users));
    expect(bands).toHaveLength(MAX_VOTER_BANDS);
    expect(bands[bands.length - 1]).toBe(OTHER_ADMINS);
  });
});

describe("buildRoadmapVotingScale", () => {
  it("gives distinct hues by rank and greys the roll-up", () => {
    const scale = buildRoadmapVotingScale(["Asha", "Bea", OTHER_ADMINS]);
    expect(scale.Asha).not.toBe(scale.Bea);
    expect(scale[OTHER_ADMINS]).toBe(CONTEXT.faint);
  });
});

describe("buildRoadmapVotingSeries", () => {
  it("emits every band in every month, zeros included, and sums to the month total", () => {
    const data = response(
      [
        month("2026-09-01", [[1, 0, 10]]),
        month("2026-10-01", [
          [1, 4, 10],
          [2, 6, 10],
        ]),
      ],
      [voter(2, "Bea", 6), voter(1, "Asha", 4)],
    );
    const series = buildRoadmapVotingSeries(data, voterBands(data));
    expect(series).toHaveLength(4);
    const sept = series.filter(d => d.key === series[0].key);
    expect(sept.every(d => d.value === 0)).toBe(true);
    const oct = series.filter(d => d.key !== series[0].key);
    expect(oct.reduce((s, d) => s + d.value, 0)).toBe(10);
  });

  it("routes voters outside the bands into Other admins", () => {
    const users = Array.from({ length: MAX_VOTER_BANDS + 1 }, (_, i) =>
      voter(i + 1, `U${i + 1}`, 100 - i),
    );
    const data = response(
      [
        month(
          "2026-10-01",
          users.map(u => [u.userId, 1, 10]),
        ),
      ],
      users,
    );
    const bands = voterBands(data);
    const series = buildRoadmapVotingSeries(data, bands);
    expect(series.find(d => d.group === OTHER_ADMINS)?.value).toBe(2);
  });
});

describe("participation", () => {
  it("reads voters of eligible, or voters alone before access was recorded", () => {
    expect(
      participationLabel(
        month("2026-10-01", [
          [1, 3, 10],
          [2, 0, 10],
        ]),
      ),
    ).toBe("1 of 2 voted");
    expect(participationLabel(month("2026-08-01", [[1, 3, null]], { recorded: false }))).toBe(
      "1 voted",
    );
  });

  it("leads the takeaway with this month so far and the last closed month", () => {
    const data = response(
      [
        month("2026-10-01", [
          [1, 30, 200],
          [2, 0, 200],
        ]),
        month(
          "2026-11-01",
          [
            [1, 0, 50],
            [2, 5, 50],
          ],
          { partial: true },
        ),
      ],
      [voter(1, "Asha", 30), voter(2, "Bea", 5)],
    );
    const t = roadmapVotingTakeaway(data)!;
    expect(t).toContain("so far: 1 of 2 voted (50%), 5 of 100 votes issued used");
    expect(t).toContain("1 of 2 voted (50%), 30 of 400 votes issued used");
  });
});

describe("buildWhoVotedGrid", () => {
  it("lists current admins in name order with 0 for non-voters and null where not eligible", () => {
    const data = response(
      [
        month("2026-09-01", [[2, 4, 10]]),
        month("2026-10-01", [
          [2, 1, 10],
          [1, 0, 10],
        ]),
      ],
      [voter(2, "Bea", 5), voter(1, "Asha", 0), voter(3, "Cy", 0)],
    );
    const grid = buildWhoVotedGrid(data);
    expect(grid.rows.map(r => r.name)).toEqual(["Asha", "Bea", "Cy"]);
    expect(grid.rows[0].cells.map(c => c.votes)).toEqual([null, 0]);
    expect(grid.rows[1].cells.map(c => c.votes)).toEqual([4, 1]);
  });

  it("keeps a past voter who has since lost access when they appear in the window", () => {
    const data = response(
      [month("2026-10-01", [[9, 3, 10]])],
      [voter(9, "Gone", 3, false), voter(1, "Asha", 0)],
    );
    expect(buildWhoVotedGrid(data).rows.map(r => r.name)).toEqual(["Asha", "Gone"]);
  });

  it("shows only the most recent months", () => {
    const months = ["05", "06", "07", "08", "09", "10", "11"].map(m =>
      month(`2026-${m}-01`, [[1, 1, 1]]),
    );
    expect(buildWhoVotedGrid(response(months, [voter(1, "Asha", 7)]), 6).months[0].month).toBe(
      "2026-06-01",
    );
  });
});

describe("table, empty and access notes", () => {
  it("exports non-voters as rows, newest month first", () => {
    const data = response(
      [month("2026-09-01", [[1, 2, 10]]), month("2026-10-01", [[1, 0, 10]])],
      [voter(1, "Asha", 2)],
    );
    const { rows } = buildRoadmapVotingTable(data);
    expect(rows).toHaveLength(2);
    expect(rows[0][2]).toBe(0);
  });

  it("separates nobody-voted-yet from nobody-has-access", () => {
    expect(roadmapVotingEmptyText(response([], [voter(1, "Asha", 0)]))).toMatch(/nobody has cast/);
    expect(roadmapVotingEmptyText(response([], []))).toMatch(/Nobody has roadmap voting access/);
  });

  it("explains months before access was recorded", () => {
    const data = response(
      [month("2026-08-01", [[1, 2, null]], { recorded: false })],
      [voter(1, "Asha", 2)],
    );
    expect(accessNote(data)).toMatch(/recorded from/);
    expect(accessNote(response([month("2026-09-01", [[1, 2, 5]])], []))).toBeUndefined();
  });
});
