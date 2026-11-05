import { CATEGORICAL, CONTEXT, ColorScale, MAX_CATEGORICAL } from "./chartScales";
import { monthLabel } from "./cohortChart";

/**
 * Pure transforms + wire types for the Highlights → Priority "Roadmap votes cast,
 * by admin" card (AAQ-254).
 *
 * Wire types live here, beside the transforms that consume them, following
 * `bugHunterVolumeChart.ts`. Mirrors ally-be's `RoadmapVotingResponseDto`
 * (src/analytics/dto/roadmap-voting-analytics.dto.ts).
 *
 * The card exists to drive adoption — more of the team voting on the roadmap — so
 * the rule these encode is that the people who did NOT vote stay visible: the
 * participation figure needs them as its denominator, and the who-voted grid shows
 * them as rows. A chart built only from votes cast cannot see who is missing.
 */

export interface RoadmapVotingUserMonth {
  userId: number;
  /** Votes cast this month that still stand; 0 for an admin who could vote and didn't. */
  votes: number;
  /** Votes issued for this month; null before the grant ledger existed. */
  granted: number | null;
}

export interface RoadmapVotingMonth {
  /** yyyy-mm-01 */
  month: string;
  partial: boolean;
  votes: number;
  voters: number;
  /** Admins who could vote; null where access was never recorded. */
  eligible: number | null;
  granted: number | null;
  users: RoadmapVotingUserMonth[];
}

export interface RoadmapVoter {
  userId: number;
  name: string;
  votes: number;
  monthsVoted: number;
  lastVotedMonth: string | null;
  hasAccessNow: boolean;
}

export interface RoadmapVotingResponse {
  months: RoadmapVotingMonth[];
  /** Highest all-time votes first, then name. */
  users: RoadmapVoter[];
  accessRecordedFrom: string | null;
  computedAt: string;
}

export const OTHER_ADMINS = "Other admins";

/** Bands before the tail rolls up — the number of hues a reader can tell apart. */
export const MAX_VOTER_BANDS = MAX_CATEGORICAL;

const PARTIAL_SUFFIX = " *";

/** Axis label; the in-progress month carries a short marker (Carbon cuts ticks at 14 chars). */
export const monthAxisLabel = (m: RoadmapVotingMonth): string =>
  m.partial ? `${monthLabel(m.month)}${PARTIAL_SUFFIX}` : monthLabel(m.month);

/**
 * The stack's bands: everyone who has ever voted, ranked on ALL-TIME votes (the
 * server's order), top {@link MAX_VOTER_BANDS} as their own band and the rest
 * rolled into {@link OTHER_ADMINS}. Ranked once on all-time totals so a person's
 * band never changes membership from one month to the next. Admins who have never
 * voted have no band — there is nothing of theirs to draw — and are named in the
 * grid instead.
 */
export const voterBands = (data: RoadmapVotingResponse | undefined): string[] => {
  const voters = (data?.users ?? []).filter(u => u.votes > 0);
  if (voters.length <= MAX_VOTER_BANDS) return voters.map(u => u.name);
  return [...voters.slice(0, MAX_VOTER_BANDS - 1).map(u => u.name), OTHER_ADMINS];
};

/**
 * One hue per band by rank rather than by a hash of the name: with at most eight
 * bands, ranked assignment guarantees no two people in the stack share a colour —
 * hashing a closed set of names collides, and two same-coloured bands sitting flush
 * read as one person. The roll-up is context grey.
 */
export const buildRoadmapVotingScale = (bands: string[]): ColorScale =>
  bands.reduce<ColorScale>((scale, band, i) => {
    scale[band] = band === OTHER_ADMINS ? CONTEXT.faint : CATEGORICAL[i % CATEGORICAL.length];
    return scale;
  }, {});

export interface RoadmapVotingDatum {
  group: string;
  key: string;
  value: number;
}

/**
 * Stacked series: one point per (month, band). Every band gets a point in every
 * month, zeros included, so a month nobody voted in is still on the axis — "nobody
 * voted in August" is a fact about August, not a gap.
 */
export const buildRoadmapVotingSeries = (
  data: RoadmapVotingResponse | undefined,
  bands: string[],
): RoadmapVotingDatum[] => {
  if (!data) return [];
  const nameOf = new Map(data.users.map(u => [u.userId, u.name]));
  const banded = new Set(bands);
  const out: RoadmapVotingDatum[] = [];
  for (const m of data.months) {
    const byBand = new Map<string, number>(bands.map(b => [b, 0]));
    for (const u of m.users) {
      if (u.votes <= 0) continue;
      const name = nameOf.get(u.userId) ?? `Admin #${u.userId}`;
      const band = banded.has(name) ? name : OTHER_ADMINS;
      byBand.set(band, (byBand.get(band) ?? 0) + u.votes);
    }
    const key = monthAxisLabel(m);
    for (const band of bands) out.push({ group: band, key, value: byBand.get(band) ?? 0 });
  }
  return out;
};

/** "4 of 11 voted", or "4 voted" where who could vote was never recorded. */
export const participationLabel = (m: RoadmapVotingMonth): string =>
  m.eligible === null ? `${m.voters} voted` : `${m.voters} of ${m.eligible} voted`;

const pct = (part: number, whole: number): number => Math.round((part / whole) * 100);

/**
 * The finding: this month's participation so far, set against the last closed
 * month. Participation leads, not the vote total — the goal is more people voting,
 * and a total can rise on one enthusiast while the rest of the team stays out.
 */
export const roadmapVotingTakeaway = (
  data: RoadmapVotingResponse | undefined,
): string | undefined => {
  const months = data?.months ?? [];
  const current = months.find(m => m.partial);
  const closed = [...months].reverse().find(m => !m.partial);

  const describe = (m: RoadmapVotingMonth): string => {
    const share = m.eligible ? ` (${pct(m.voters, m.eligible)}%)` : "";
    const used =
      m.granted && m.granted > 0
        ? `, ${m.votes.toLocaleString()} of ${m.granted.toLocaleString()} votes issued used`
        : `, ${m.votes.toLocaleString()} votes`;
    return `${participationLabel(m)}${share}${used}`;
  };

  const parts: string[] = [];
  if (current) parts.push(`${monthLabel(current.month)} so far: ${describe(current)}`);
  if (closed) parts.push(`${monthLabel(closed.month)}: ${describe(closed)}`);
  return parts.length ? parts.join(" · ") : undefined;
};

/** One cell of the who-voted grid. */
export interface WhoVotedCell {
  /** Null when the admin was not on the team's eligible list that month. */
  votes: number | null;
  granted: number | null;
}

export interface WhoVotedGrid {
  months: RoadmapVotingMonth[];
  rows: { userId: number; name: string; cells: WhoVotedCell[] }[];
}

/**
 * The adoption view: one row per admin, one column per recent month, a cell per
 * month showing their votes — and a 0 where they could have voted and didn't.
 *
 * Rows are in NAME order, not ranked. The chart above already ranks by volume; a
 * second ranking down the side would turn the grid into a leaderboard, and a
 * bottom-of-the-table position is a reason to disengage rather than to start. Name
 * order keeps each person's row in the same place every month, so the reader scans
 * for the gaps, not for the positions.
 *
 * Who is listed: everyone with access now, plus anyone who appears in one of the
 * shown months (an admin who voted and has since left still voted).
 */
export const buildWhoVotedGrid = (
  data: RoadmapVotingResponse | undefined,
  monthsToShow = 6,
): WhoVotedGrid => {
  if (!data || data.months.length === 0) return { months: [], rows: [] };
  const months = data.months.slice(-monthsToShow);
  const inShown = new Set(months.flatMap(m => m.users.map(u => u.userId)));
  const listed = data.users
    .filter(u => u.hasAccessNow || inShown.has(u.userId))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    months,
    rows: listed.map(u => ({
      userId: u.userId,
      name: u.name,
      cells: months.map(m => {
        const cell = m.users.find(x => x.userId === u.userId);
        return cell ? { votes: cell.votes, granted: cell.granted } : { votes: null, granted: null };
      }),
    })),
  };
};

/**
 * Long-format detail for the expand modal and the export: one row per admin per
 * month they could vote in, non-voters included, so the export carries the
 * denominator as well as the votes.
 */
export const buildRoadmapVotingTable = (
  data: RoadmapVotingResponse | undefined,
): { columns: string[]; rows: (string | number)[][] } => {
  const columns = ["Month", "Admin", "Votes cast", "Votes issued", "Team: voted / could vote"];
  if (!data) return { columns, rows: [] };
  const nameOf = new Map(data.users.map(u => [u.userId, u.name]));
  const rows: (string | number)[][] = [];
  for (const m of [...data.months].reverse()) {
    const label = m.partial ? `${monthLabel(m.month)} (in progress)` : monthLabel(m.month);
    const users = [...m.users].sort(
      (a, b) =>
        b.votes - a.votes || (nameOf.get(a.userId) ?? "").localeCompare(nameOf.get(b.userId) ?? ""),
    );
    for (const u of users) {
      rows.push([
        label,
        nameOf.get(u.userId) ?? `Admin #${u.userId}`,
        u.votes,
        u.granted ?? "not recorded",
        participationLabel(m),
      ]);
    }
  }
  return { columns, rows };
};

export const roadmapVotingEmptyText = (
  data: RoadmapVotingResponse | undefined,
): string | undefined => {
  if (!data) return undefined;
  if (data.months.length === 0) {
    return data.users.length > 0
      ? `${data.users.length} admins can vote on the roadmap, and nobody has cast a vote yet.`
      : "Nobody has roadmap voting access yet.";
  }
  return undefined;
};

export const partialFootnote = (data: RoadmapVotingResponse | undefined): string | undefined => {
  const current = data?.months.find(m => m.partial);
  return current
    ? `* ${monthLabel(current.month)} is still open — that bar and its participation can only grow.`
    : undefined;
};

/** Says where the participation denominator starts, when the axis reaches back before it. */
export const accessNote = (data: RoadmapVotingResponse | undefined): string | undefined => {
  if (!data || data.months.length === 0) return undefined;
  const from = data.accessRecordedFrom;
  if (from === null) {
    return "Who could vote has not been recorded yet, so months show voters only, not a share of the team.";
  }
  if (data.months[0].month < from) {
    return (
      `Who could vote is recorded from ${monthLabel(from)}, when vote grants started. ` +
      `Earlier months show voters only, not a share of the team.`
    );
  }
  return undefined;
};
