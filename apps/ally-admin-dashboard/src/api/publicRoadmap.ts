import { ApiEndpoints, HttpMethod, TAG_TYPES } from "@constants";

import { baseAPI } from "./baseApi";

export type PublicRoadmapCategory = "prepare" | "perform";

export type PublicRoadmapStage = "idea" | "lab" | "beta" | "released" | "stable";

/** One card on the public roadmap. Mirrors ally-be's PublicRoadmapItemDto. */
export type PublicRoadmapItem = {
  id: string;
  title: string;
  description: string;
  /** One-line callout such as "Current priority"; null when there is none. */
  note: string | null;
  category: PublicRoadmapCategory;
  stage: PublicRoadmapStage;
  /** Position within its category × stage cell, ascending. */
  sortOrder: number;
  /** False keeps the card in this list but off the public page. */
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PublicRoadmapItemInput = Pick<
  PublicRoadmapItem,
  "title" | "description" | "note" | "category" | "stage" | "isPublic"
>;

export const publicRoadmapAPI = baseAPI.injectEndpoints({
  endpoints: builder => ({
    getPublicRoadmapItems: builder.query<PublicRoadmapItem[], void>({
      query: () => ({ url: ApiEndpoints.PUBLIC_ROADMAP.ITEMS, method: HttpMethod.GET }),
      providesTags: [TAG_TYPES.PUBLIC_ROADMAP],
    }),
    createPublicRoadmapItem: builder.mutation<PublicRoadmapItem, PublicRoadmapItemInput>({
      query: body => ({ url: ApiEndpoints.PUBLIC_ROADMAP.ITEMS, method: HttpMethod.POST, body }),
      invalidatesTags: [TAG_TYPES.PUBLIC_ROADMAP],
    }),
    updatePublicRoadmapItem: builder.mutation<
      PublicRoadmapItem,
      { id: string } & Partial<PublicRoadmapItemInput>
    >({
      query: ({ id, ...body }) => ({
        url: ApiEndpoints.PUBLIC_ROADMAP.ITEM(id),
        method: HttpMethod.PATCH,
        body,
      }),
      invalidatesTags: [TAG_TYPES.PUBLIC_ROADMAP],
    }),
    deletePublicRoadmapItem: builder.mutation<{ success: boolean }, string>({
      query: id => ({ url: ApiEndpoints.PUBLIC_ROADMAP.ITEM(id), method: HttpMethod.DELETE }),
      invalidatesTags: [TAG_TYPES.PUBLIC_ROADMAP],
    }),
    /** Every card in one category × stage cell, top to bottom. */
    reorderPublicRoadmapItems: builder.mutation<PublicRoadmapItem[], string[]>({
      query: ids => ({
        url: ApiEndpoints.PUBLIC_ROADMAP.ORDER,
        method: HttpMethod.PUT,
        body: { ids },
      }),
      invalidatesTags: [TAG_TYPES.PUBLIC_ROADMAP],
    }),
  }),
});

export const {
  useGetPublicRoadmapItemsQuery,
  useCreatePublicRoadmapItemMutation,
  useUpdatePublicRoadmapItemMutation,
  useDeletePublicRoadmapItemMutation,
  useReorderPublicRoadmapItemsMutation,
} = publicRoadmapAPI;
