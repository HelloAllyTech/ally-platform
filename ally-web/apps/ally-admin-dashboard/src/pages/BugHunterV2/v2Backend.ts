import { useMemo } from "react";

import * as api from "@api";
import { FeatureToggleKey } from "@constants";
import { ListBugFindingsQuery } from "@types";

import { byId, isV2Id, mergeFindings } from "./v2BackendCore";
import { BugHunterBackend, BugHunterBackendFeatures } from "../BugHunter/bugHunterBackend";

export { isV2Id, mergeFindings } from "./v2BackendCore";

/**
 * Bug Hunter v2 behind the old Bug Hunter's page (chunk 11, "match the old UI exactly").
 *
 * The page lists two kinds of bug, in the old page's own shapes:
 * - v2's queue, from ally-be's compat routes (ids `v2-<n>`), whose buttons act on v2:
 *   Approve opens a PR on a suggested fix, Put me on it queues the bug, Decline
 *   dismisses it, Merge and Release are v2's;
 * - the old Bug Hunter's own history, straight from its API, as the old page shows it.
 * A bug reported after v2 was set up exists on both sides; the old copy is dropped.
 *
 * What v2 has no equivalent for (sweeps, Today, UX scan, feature map, notebook, answer,
 * edit description, cancel, stage pinning) is hidden on this page.
 */
export const V2_FEATURES: BugHunterBackendFeatures = {
  notebook: false,
  sweeps: false,
  today: false,
  uxScan: false,
  featureMap: false,
  answer: false,
  editDescription: false,
  cancelFixSession: false,
  stageEditor: false,
  triageFeature: FeatureToggleKey.BUG_HUNTER_V2_VERDICTS,
};

type QueryOpts = Record<string, unknown> | undefined;

const useFindings = (args?: ListBugFindingsQuery | void, opts?: QueryOpts) => {
  const v2 = api.useGetBugHunterV2CompatFindingsQuery(args, opts);
  // The old history needs the old Bug Hunter's toggle; without it this simply errors
  // and the page shows v2's bugs alone.
  const v1 = api.useGetBugFindingsQuery(args, opts);
  const data = useMemo(() => mergeFindings(v2.data, v1.data), [v2.data, v1.data]);
  const currentData = useMemo(
    () => mergeFindings(v2.currentData, v1.currentData),
    [v2.currentData, v1.currentData],
  );
  return {
    ...v2,
    data,
    currentData,
    isLoading: v2.isLoading,
    isFetching: v2.isFetching || v1.isFetching,
    isError: v2.isError,
    refetch: () => {
      v1.refetch();
      return v2.refetch();
    },
  };
};

const useFinding = (id: string, opts?: QueryOpts) => {
  const ours = isV2Id(id);
  const v2 = api.useGetBugHunterV2CompatFindingQuery(id, { ...opts, skip: !ours });
  const v1 = api.useGetBugFindingQuery(id, { ...opts, skip: ours });
  return ours ? v2 : v1;
};

const useDecisions = (id: string, opts?: QueryOpts) => {
  const ours = isV2Id(id);
  const v2 = api.useGetBugHunterV2CompatDecisionsQuery(id, { ...opts, skip: !ours });
  const v1 = api.useGetBugFindingDecisionsQuery(id, { ...opts, skip: ours });
  return ours ? v2 : v1;
};

/**
 * `@api`'s hook, looked up when called rather than when this module loads, so a test
 * that mocks `@api` wholesale (and supplies only what it uses) can still import this.
 */
const late =
  <K extends keyof typeof api>(name: K) =>
  (...args: unknown[]): any =>
    (api[name] as unknown as (...a: unknown[]) => unknown)(...args);

/** Sweeps are the old Bug Hunter's; v2 has none to show. */
const NO_RUNS = { items: [] };
const useNoRuns = () => ({
  data: NO_RUNS,
  currentData: NO_RUNS,
  isLoading: false,
  isFetching: false,
  isError: false,
  refetch: () => undefined,
});
const useNothing = () => ({
  data: undefined,
  currentData: undefined,
  isLoading: false,
  isFetching: false,
  isError: false,
  refetch: () => undefined,
});
const useNoMutation = () =>
  [
    () => ({ unwrap: () => Promise.reject(new Error("Not available in Bug Hunter v2.")) }),
    { isLoading: false },
  ] as const;

export const V2_BACKEND: BugHunterBackend = {
  features: V2_FEATURES,
  hooks: {
    useGetBugHunterSettingsQuery: late("useGetBugHunterV2CompatSettingsQuery"),
    useUpdateBugHunterSettingsMutation: late("useUpdateBugHunterV2CompatSettingsMutation"),
    useGetBugFindingsQuery: useFindings,
    useGetBugFindingQuery: useFinding,
    useGetBugFindingDecisionsQuery: useDecisions,
    useApproveBugFindingMutation: byId<any>(
      late("useApproveBugHunterV2CompatMutation"),
      late("useApproveBugFindingMutation"),
    ),
    useRejectBugFindingMutation: byId<any>(
      late("useRejectBugHunterV2CompatMutation"),
      late("useRejectBugFindingMutation"),
    ),
    useStartBugFixSessionMutation: byId<any>(
      late("useStartBugHunterV2CompatMutation"),
      late("useStartBugFixSessionMutation"),
    ),
    useMergeBugFindingMutation: byId<any>(
      late("useMergeBugHunterV2CompatMutation"),
      late("useMergeBugFindingMutation"),
    ),
    useReleaseBugFindingMutation: byId<any>(
      late("useReleaseBugHunterV2CompatMutation"),
      late("useReleaseBugFindingMutation"),
    ),
    useGetBugHuntRunsQuery: useNoRuns,
    useGetBugHuntRunQuery: useNothing,
    useGetBugHuntRunDecisionsQuery: useNothing,
    useGetBugHunterTodayQuery: useNothing,
    useGetUxSignalScansQuery: useNothing,
    useScanUxSignalsMutation: useNoMutation,
    useGetBugHunterFeatureMapsQuery: useNothing,
    useRefreshBugHunterFeatureMapsMutation: useNoMutation,
    useRemoveBugHunterFeatureMapMutation: useNoMutation,
    useAnswerBugFindingMutation: useNoMutation,
    useEditBugFindingDescriptionMutation: useNoMutation,
    useCancelBugFixSessionMutation: useNoMutation,
    useSetBugFindingStageMutation: useNoMutation,
  } as unknown as BugHunterBackend["hooks"],
};
