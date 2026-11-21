import { createContext, FC, ReactNode, useContext } from "react";

import * as api from "@api";
import { FeatureToggleKey } from "@constants";

/**
 * Where the Bug Hunter page gets its data (chunk 11 of Bug Hunter v2).
 *
 * The page's components import the data hooks below instead of from `@api`. Each one
 * calls the implementation the nearest `BugHunterBackendProvider` supplies, and the old
 * Bug Hunter's own hook when there is none — so `/bug-hunter` behaves exactly as before,
 * and `/bug-hunter-v2` renders the very same page on Bug Hunter v2's data. That is what
 * "match the old UI exactly" means: one page, two backends, not a copy.
 *
 * Hooks are looked up on every call (not captured at module load), so a test that mocks
 * `@api` wholesale still gets its mocks, and a module without a provider has no work to
 * do at import time.
 */
type Api = typeof api;

export const BACKEND_HOOK_NAMES = [
  "useAnswerBugFindingMutation",
  "useApproveBugFindingMutation",
  "useCancelBugFixSessionMutation",
  "useEditBugFindingDescriptionMutation",
  "useGetBugFindingDecisionsQuery",
  "useGetBugFindingQuery",
  "useGetBugFindingsQuery",
  "useGetBugHuntRunDecisionsQuery",
  "useGetBugHuntRunQuery",
  "useGetBugHuntRunsQuery",
  "useGetBugHunterFeatureMapsQuery",
  "useGetBugHunterSettingsQuery",
  "useGetBugHunterTodayQuery",
  "useGetUxSignalScansQuery",
  "useMergeBugFindingMutation",
  "useRefreshBugHunterFeatureMapsMutation",
  "useRejectBugFindingMutation",
  "useReleaseBugFindingMutation",
  "useRemoveBugHunterFeatureMapMutation",
  "useScanUxSignalsMutation",
  "useSetBugFindingStageMutation",
  "useStartBugFixSessionMutation",
  "useUpdateBugHunterSettingsMutation",
] as const;

export type BackendHookName = (typeof BACKEND_HOOK_NAMES)[number];
export type BackendHooks = { [K in BackendHookName]: Api[K] };

/** Parts of the page a backend may not support; hidden when false. */
export interface BugHunterBackendFeatures {
  /** The Notebook section (notes and the feature map). */
  notebook: boolean;
  /** Sweep runs: "last sweep" in the header, a run's own scope, run history. */
  sweeps: boolean;
  /** The per-repo Today board. */
  today: boolean;
  /** "Scan UX signals" in the header menu. */
  uxScan: boolean;
  /** "Map features" in the header menu. */
  featureMap: boolean;
  /** Answering Bug Hunter's question in the drawer. */
  answer: boolean;
  /** Editing a bug's description. */
  editDescription: boolean;
  /** Cancelling a running fix. */
  cancelFixSession: boolean;
  /** Pinning a bug's roadmap stage. */
  stageEditor: boolean;
  /** The toggle that lets someone act on bugs (approve, decline, put on, merge). */
  triageFeature: (typeof FeatureToggleKey)[keyof typeof FeatureToggleKey];
}

export interface BugHunterBackend {
  hooks: Partial<BackendHooks>;
  features: BugHunterBackendFeatures;
}

export const V1_FEATURES: BugHunterBackendFeatures = {
  notebook: true,
  sweeps: true,
  today: true,
  uxScan: true,
  featureMap: true,
  answer: true,
  editDescription: true,
  cancelFixSession: true,
  stageEditor: true,
  triageFeature: FeatureToggleKey.BUG_HUNTER,
};

const BackendContext = createContext<BugHunterBackend | null>(null);

export const BugHunterBackendProvider: FC<{ value: BugHunterBackend; children: ReactNode }> = ({
  value,
  children,
}) => <BackendContext.Provider value={value}>{children}</BackendContext.Provider>;

/** The features of the page's backend (the old Bug Hunter's when there is no provider). */
export const useBugHunterFeatures = (): BugHunterBackendFeatures =>
  useContext(BackendContext)?.features ?? V1_FEATURES;

const pick = <K extends BackendHookName>(name: K): ((...args: never[]) => unknown) => {
  // Hooks rule: the same provider is in place for the whole life of a page, so every
  // render of a component calls the same implementation.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const backend = useContext(BackendContext);
  return ((backend?.hooks[name] as unknown) ?? (api as Api)[name]) as (...args: never[]) => unknown;
};

const wrap = <K extends BackendHookName>(name: K): Api[K] =>
  ((...args: never[]) => pick(name)(...args)) as unknown as Api[K];

export const useAnswerBugFindingMutation = wrap("useAnswerBugFindingMutation");
export const useApproveBugFindingMutation = wrap("useApproveBugFindingMutation");
export const useCancelBugFixSessionMutation = wrap("useCancelBugFixSessionMutation");
export const useEditBugFindingDescriptionMutation = wrap("useEditBugFindingDescriptionMutation");
export const useGetBugFindingDecisionsQuery = wrap("useGetBugFindingDecisionsQuery");
export const useGetBugFindingQuery = wrap("useGetBugFindingQuery");
export const useGetBugFindingsQuery = wrap("useGetBugFindingsQuery");
export const useGetBugHuntRunDecisionsQuery = wrap("useGetBugHuntRunDecisionsQuery");
export const useGetBugHuntRunQuery = wrap("useGetBugHuntRunQuery");
export const useGetBugHuntRunsQuery = wrap("useGetBugHuntRunsQuery");
export const useGetBugHunterFeatureMapsQuery = wrap("useGetBugHunterFeatureMapsQuery");
export const useGetBugHunterSettingsQuery = wrap("useGetBugHunterSettingsQuery");
export const useGetBugHunterTodayQuery = wrap("useGetBugHunterTodayQuery");
export const useGetUxSignalScansQuery = wrap("useGetUxSignalScansQuery");
export const useMergeBugFindingMutation = wrap("useMergeBugFindingMutation");
export const useRefreshBugHunterFeatureMapsMutation = wrap(
  "useRefreshBugHunterFeatureMapsMutation",
);
export const useRejectBugFindingMutation = wrap("useRejectBugFindingMutation");
export const useReleaseBugFindingMutation = wrap("useReleaseBugFindingMutation");
export const useRemoveBugHunterFeatureMapMutation = wrap("useRemoveBugHunterFeatureMapMutation");
export const useScanUxSignalsMutation = wrap("useScanUxSignalsMutation");
export const useSetBugFindingStageMutation = wrap("useSetBugFindingStageMutation");
export const useStartBugFixSessionMutation = wrap("useStartBugFixSessionMutation");
export const useUpdateBugHunterSettingsMutation = wrap("useUpdateBugHunterSettingsMutation");
