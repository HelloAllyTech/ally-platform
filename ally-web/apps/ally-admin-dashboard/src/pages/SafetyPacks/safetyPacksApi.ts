import { HttpMethod } from "@constants";

import { baseAPI } from "../../api/baseApi";

/**
 * Safety pack releases (assistants stage 9). Shapes match ally-be
 * `bot-draft/safety-pack/releases/safety-pack-release.service.ts`; every route is Ally staff with
 * `manage:safety-packs` (404 to anyone else).
 */

export type ReleaseStatus = "draft" | "testing" | "released" | "rolled_back";

export interface ReleaseLanguageResult {
  language: string;
  status: "pass" | "fail" | "error";
  passed: number;
  total: number;
  failedCases: string[];
}

export interface ReleaseTestResults {
  state: "running" | "done" | "error";
  chatbotId: string;
  startedAt: string;
  finishedAt?: string;
  languages: ReleaseLanguageResult[];
  allPassed: boolean;
  error?: string;
}

export interface PackRelease {
  id: string;
  packId: string;
  version: number;
  status: ReleaseStatus;
  current: boolean;
  note: string | null;
  createdBy: number | null;
  createdAt: string;
  releasedAt: string | null;
  releasedBy: number | null;
  rolledBackAt: string | null;
  rolledBackBy: number | null;
  previousReleaseId: string | null;
  testResults: ReleaseTestResults | null;
}

export interface PackContent {
  id: string;
  version: number;
  name: string;
  industryLabel: string;
  builderMessage: string;
  summary: string;
  disclaimer: string | null;
  rules: string[];
  always: string[];
  never: string[];
  atRisk: string[];
  probes: string[];
  requiredSettings: { crisisClassifierEnabled: boolean };
}

export type ListField = "rules" | "always" | "never" | "atRisk" | "probes";

export interface PackDiff {
  lists: Record<ListField, { added: string[]; removed: string[] }>;
  text: { field: string; from: string | null; to: string | null }[];
  classifier: { from: boolean; to: boolean } | null;
  changed: boolean;
}

export interface PackReleaseDetail extends PackRelease {
  content: PackContent;
  currentContent: PackContent;
  diff: PackDiff;
  blockers: string[];
}

export interface SafetyPackSummary {
  packId: string;
  name: string;
  codeVersion: number;
  currentReleaseId: string | null;
  currentVersion: number | null;
  canRollBack: boolean;
  chatbots: number;
  releases: PackRelease[];
}

export interface SafetyPacksOverview {
  enabled: boolean;
  languages: string[];
  suiteVersion: string;
  packs: SafetyPackSummary[];
}

export type PackDraftChange = Partial<
  Pick<PackContent, ListField | "name" | "industryLabel" | "builderMessage" | "summary">
> & { disclaimer?: string | null; note?: string };

const BASE = "/v1/staff/safety-packs";

export const SAFETY_PACKS_API = {
  LIST: BASE,
  RELEASE: (id: string) => `${BASE}/releases/${id}`,
  CREATE: (packId: string) => `${BASE}/${packId}/releases`,
  SUITE: (id: string) => `${BASE}/releases/${id}/suite`,
  RELEASE_IT: (id: string) => `${BASE}/releases/${id}/release`,
  ROLLBACK: (packId: string) => `${BASE}/${packId}/rollback`,
};

export const safetyPacksApi = baseAPI.injectEndpoints({
  endpoints: builder => ({
    getSafetyPacks: builder.query<SafetyPacksOverview, void>({
      query: () => ({ url: SAFETY_PACKS_API.LIST, method: HttpMethod.GET }),
    }),
    getSafetyPackRelease: builder.query<PackReleaseDetail, string>({
      query: id => ({ url: SAFETY_PACKS_API.RELEASE(id), method: HttpMethod.GET }),
    }),
    createSafetyPackDraft: builder.mutation<
      PackReleaseDetail,
      { packId: string; source?: "current" | "code"; note?: string }
    >({
      query: ({ packId, ...body }) => ({
        url: SAFETY_PACKS_API.CREATE(packId),
        method: HttpMethod.POST,
        body,
      }),
    }),
    updateSafetyPackDraft: builder.mutation<
      PackReleaseDetail,
      { id: string; change: PackDraftChange }
    >({
      query: ({ id, change }) => ({
        url: SAFETY_PACKS_API.RELEASE(id),
        method: HttpMethod.PATCH,
        body: change,
      }),
    }),
    runSafetyPackSuite: builder.mutation<PackReleaseDetail, { id: string; chatbotId: string }>({
      query: ({ id, chatbotId }) => ({
        url: SAFETY_PACKS_API.SUITE(id),
        method: HttpMethod.POST,
        body: { chatbotId },
      }),
    }),
    releaseSafetyPack: builder.mutation<PackReleaseDetail, string>({
      query: id => ({ url: SAFETY_PACKS_API.RELEASE_IT(id), method: HttpMethod.POST }),
    }),
    rollbackSafetyPack: builder.mutation<PackReleaseDetail, { packId: string; note?: string }>({
      query: ({ packId, note }) => ({
        url: SAFETY_PACKS_API.ROLLBACK(packId),
        method: HttpMethod.POST,
        body: { note },
      }),
    }),
  }),
});

export const {
  useGetSafetyPacksQuery,
  useGetSafetyPackReleaseQuery,
  useCreateSafetyPackDraftMutation,
  useUpdateSafetyPackDraftMutation,
  useRunSafetyPackSuiteMutation,
  useReleaseSafetyPackMutation,
  useRollbackSafetyPackMutation,
} = safetyPacksApi;
