import { ApiEndpoints, HttpMethod } from "@constants";

import { baseAPI } from "./baseAPI";

export type RoadmapCategory = "prepare" | "perform";

export type RoadmapStage = "idea" | "lab" | "beta" | "released" | "stable";

/** One card on the public roadmap. Mirrors ally-be's PublicRoadmapCardDto. */
export type RoadmapCard = {
  id: string;
  title: string;
  description: string;
  /** One-line callout such as "Current priority"; null when there is none. */
  note: string | null;
  category: RoadmapCategory;
  stage: RoadmapStage;
  /** Position within its category × stage cell, ascending. */
  sortOrder: number;
};

export type PublicRoadmapResponse = {
  items: RoadmapCard[];
  /** When a card on the page last changed (ISO 8601); null when it is empty. */
  updatedAt: string | null;
};

const publicRoadmapAPI = baseAPI.injectEndpoints({
  endpoints: builder => ({
    getPublicRoadmap: builder.query<PublicRoadmapResponse, void>({
      query: () => ({
        url: ApiEndpoints.PUBLIC_ROADMAP.GET_PUBLIC,
        method: HttpMethod.GET,
      }),
    }),
  }),
});

export const { useGetPublicRoadmapQuery } = publicRoadmapAPI;
