import { HttpMethod, TAG_TYPES } from "@constants";

import { baseAPI } from "../../api/baseApi";

/**
 * Assistants admin → Defaults & library → Templates. Shapes match ally-be
 * `bot-draft/templates/template-admin.service.ts` and
 * `chatbot/templates/template-validation.ts`; every route is Ally staff with system access
 * (404 to anyone else).
 */

export type TemplateGroup = "organisations" | "businesses";
export type Ability = "do_it" | "never";
export type SetupKind = "text" | "long_text" | "yes_no" | "choices" | "phone";
export type CheckupExpect = "answer" | "decline" | "clarify" | "crisis_only";

/** Where a setup answer goes (`SetupFill` in ally-be). */
export type SetupFill =
  | { to: "fact" }
  | { to: "helpline" }
  | { to: "entries"; list: string; columns: string[] }
  | { to: "field"; list: string; field: string }
  | { to: "options"; list: string; field: string }
  | { to: "pack"; pack: string }
  | { to: "languages" }
  | { to: "channel" }
  | { to: "list" };

export interface TemplateListUse {
  key: string;
  find: Ability;
  create: Ability;
  update: Ability;
  line: string;
  only_if?: string;
  examples?: Record<string, unknown>[];
}

export interface SetupQuestion {
  key: string;
  ask: string;
  kind: SetupKind;
  choices?: string[];
  hint?: string;
  fills: SetupFill[];
}

export interface StarterCase {
  id: string;
  send: string;
  expect: CheckupExpect;
  facts: string[];
  must_not?: string[];
  also_ok?: string[];
  hard_fail?: boolean;
  needs?: string;
}

/** A whole template (`UseCaseTemplate` in ally-be). */
export interface TemplateManifest {
  id: string;
  group: TemplateGroup;
  name: string;
  one_liner: string;
  for: string;
  icon: string;
  purpose: string;
  pack: string | null;
  hand_over: boolean;
  memory: boolean;
  memory_notice?: string;
  organisation_only?: boolean;
  instructions: string;
  lists: TemplateListUse[];
  setup: SetupQuestion[];
  checkups: StarterCase[];
  suggested_for: string[];
}

export interface TemplateIssue {
  severity: "error" | "warning";
  /** `name`, `lists.2.line`, `setup.0.fills.1`, `checkups.3.send`… */
  path: string;
  message: string;
}

export type TemplateState = "built_in" | "overridden" | "published" | "unpublished";

export interface TemplateRow {
  key: string;
  name: string;
  group: TemplateGroup;
  one_liner: string;
  icon: string;
  origin: "built_in" | "custom";
  state: TemplateState;
  live_version: number | null;
  draft_version: number | null;
  installs: number;
  updated_at: string | null;
}

export type VersionStatus = "draft" | "published" | "retired";

export interface TemplateVersion {
  id: string;
  version: number;
  status: VersionStatus;
  note: string | null;
  created_at: string;
  published_at: string | null;
  retired_at: string | null;
}

export interface TemplateDraft extends TemplateVersion {
  manifest: TemplateManifest;
  issues: TemplateIssue[];
}

export interface TemplateDetail {
  key: string;
  origin: "built_in" | "custom";
  built_in: TemplateManifest | null;
  live: (TemplateVersion & { manifest: TemplateManifest }) | null;
  /** The newest version no longer live: what a taken-down template looked like. */
  last_retired: (TemplateVersion & { manifest: TemplateManifest }) | null;
  draft: TemplateDraft | null;
  versions: TemplateVersion[];
  installs: number;
}

export interface ListMeta {
  key: string;
  name: string;
  fields: {
    key: string;
    label: string;
    type: string;
    agent_write: boolean;
    example_options: boolean;
    to: string | null;
  }[];
}

export interface TemplatesMeta {
  lists: ListMeta[];
  packs: { id: string; name: string }[];
  purposes: { id: string; name: string }[];
  groups: { id: TemplateGroup; name: string }[];
  limits: Record<string, [number, number]>;
  key_pattern: string;
}

const BASE = "/v1/staff/assistant-templates";

export const TEMPLATES_ADMIN_API = {
  LIST: BASE,
  META: `${BASE}/meta`,
  ONE: (key: string) => `${BASE}/${key}`,
  VERSION: (key: string, version: number) => `${BASE}/${key}/versions/${version}`,
  DRAFT: (key: string) => `${BASE}/${key}/draft`,
  PUBLISH: (key: string) => `${BASE}/${key}/draft/publish`,
  UNPUBLISH: (key: string) => `${BASE}/${key}/unpublish`,
  RESTORE: (key: string, version: number) => `${BASE}/${key}/versions/${version}/restore`,
};

const LIST_TAG = { type: TAG_TYPES.ASSISTANT_TEMPLATES_ADMIN, id: "LIST" } as const;
const oneTag = (key: string) => ({ type: TAG_TYPES.ASSISTANT_TEMPLATES_ADMIN, id: key }) as const;

export const templatesAdminApi = baseAPI.injectEndpoints({
  endpoints: builder => ({
    getTemplatesAdminList: builder.query<{ templates: TemplateRow[] }, void>({
      query: () => ({ url: TEMPLATES_ADMIN_API.LIST, method: HttpMethod.GET }),
      providesTags: [LIST_TAG],
    }),
    getTemplatesAdminMeta: builder.query<TemplatesMeta, void>({
      query: () => ({ url: TEMPLATES_ADMIN_API.META, method: HttpMethod.GET }),
    }),
    getTemplateAdmin: builder.query<TemplateDetail, string>({
      query: key => ({ url: TEMPLATES_ADMIN_API.ONE(key), method: HttpMethod.GET }),
      providesTags: (_r, _e, key) => [oneTag(key)],
    }),
    getTemplateVersion: builder.query<
      TemplateVersion & { manifest: TemplateManifest },
      { key: string; version: number }
    >({
      query: ({ key, version }) => ({
        url: TEMPLATES_ADMIN_API.VERSION(key, version),
        method: HttpMethod.GET,
      }),
    }),
    /** Blank, or a copy: the same key as the source edits it; a new key makes a new template. */
    createTemplateDraft: builder.mutation<
      TemplateDraft,
      { key: string; name?: string; from?: { key: string; version?: number } }
    >({
      query: body => ({ url: TEMPLATES_ADMIN_API.LIST, method: HttpMethod.POST, body }),
      invalidatesTags: (_r, _e, { key }) => [LIST_TAG, oneTag(key)],
    }),
    // No tag on the detail: the editor holds the draft it is editing, a refetch would race it.
    saveTemplateDraft: builder.mutation<
      TemplateDraft,
      { key: string; manifest: TemplateManifest; note?: string | null }
    >({
      query: ({ key, ...body }) => ({
        url: TEMPLATES_ADMIN_API.DRAFT(key),
        method: HttpMethod.PUT,
        body,
      }),
      invalidatesTags: [LIST_TAG],
    }),
    discardTemplateDraft: builder.mutation<{ ok: true }, string>({
      query: key => ({ url: TEMPLATES_ADMIN_API.DRAFT(key), method: HttpMethod.DELETE }),
      invalidatesTags: (_r, _e, key) => [LIST_TAG, oneTag(key)],
    }),
    publishTemplate: builder.mutation<TemplateVersion, { key: string; note?: string | null }>({
      query: ({ key, ...body }) => ({
        url: TEMPLATES_ADMIN_API.PUBLISH(key),
        method: HttpMethod.POST,
        body,
      }),
      invalidatesTags: (_r, _e, { key }) => [LIST_TAG, oneTag(key)],
    }),
    unpublishTemplate: builder.mutation<TemplateVersion, string>({
      query: key => ({ url: TEMPLATES_ADMIN_API.UNPUBLISH(key), method: HttpMethod.POST }),
      invalidatesTags: (_r, _e, key) => [LIST_TAG, oneTag(key)],
    }),
    restoreTemplateVersion: builder.mutation<TemplateDraft, { key: string; version: number }>({
      query: ({ key, version }) => ({
        url: TEMPLATES_ADMIN_API.RESTORE(key, version),
        method: HttpMethod.POST,
      }),
      invalidatesTags: (_r, _e, { key }) => [LIST_TAG, oneTag(key)],
    }),
  }),
});

export const {
  useGetTemplatesAdminListQuery,
  useGetTemplatesAdminMetaQuery,
  useGetTemplateAdminQuery,
  useGetTemplateVersionQuery,
  useCreateTemplateDraftMutation,
  useSaveTemplateDraftMutation,
  useDiscardTemplateDraftMutation,
  usePublishTemplateMutation,
  useUnpublishTemplateMutation,
  useRestoreTemplateVersionMutation,
} = templatesAdminApi;
