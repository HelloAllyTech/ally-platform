/**
 * Switch on Roadmap (Roadmap v2 P6): `GET /v1/roadmap/cutover/preview` and `POST /v1/roadmap/cutover`.
 * Owner only, and the two Roadmap routes that answer while `roadmap_v2` is off. People are named by
 * name and id only.
 */
export interface RoadmapCutoverPerson {
  userId: number;
  name: string;
}

export interface RoadmapCutoverCounts {
  draftsMoved: number;
  sessionsFiled: number;
  reviewsAccepted: number;
  builders: number;
  owners: number;
}

export interface RoadmapCutoverPreview {
  roadmapV2Enabled: boolean;
  builders: RoadmapCutoverPerson[];
  owners: RoadmapCutoverPerson[];
  /** Promoted, but their Product Roadmap toggle is off: they can't open the Roadmap yet. */
  withoutRoadmapAccess: RoadmapCutoverPerson[];
  drafts: {
    total: number;
    items: { id: string; authorUserId: number; authorName: string; title: string }[];
  };
  sessions: {
    total: number;
    items: {
      sessionId: string;
      title: string;
      status: string;
      creatorUserId: number;
      creatorName: string;
    }[];
  };
  reviewBackfill: { total: number };
  /** The goal a session's idea is filed under; null when there are no goals. */
  goal: string | null;
  lastRun: {
    at: string;
    actorUserId: number | null;
    actorName: string | null;
    counts: RoadmapCutoverCounts;
  } | null;
}

export interface RoadmapCutoverRequest {
  confirmedBuilderIds: number[];
  confirmedOwnerIds: number[];
}

export interface RoadmapCutoverResult {
  counts: RoadmapCutoverCounts;
  drafts: { draftId: string; code: string }[];
  filed: { sessionId: string; code: string }[];
  roadmapV2Enabled: true;
  at: string;
}
