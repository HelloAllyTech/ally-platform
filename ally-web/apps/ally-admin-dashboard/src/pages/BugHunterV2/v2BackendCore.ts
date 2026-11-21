import { BugFinding, ListBugFindingsResponse } from "@types";

/**
 * The pure half of Bug Hunter v2's backend for the old page (no `@api`, so it is
 * testable on its own): which bug is whose, the merged list, and routing a button.
 */
export const isV2Id = (id: string | null | undefined): boolean =>
  typeof id === "string" && id.startsWith("v2-");

export const idOf = (arg: unknown): string =>
  typeof arg === "string" ? arg : String((arg as { id?: string } | null)?.id ?? "");

/** v2's bugs first (newest first), then the old history, without a bug twice. */
export const mergeFindings = (
  v2: ListBugFindingsResponse | undefined,
  v1: ListBugFindingsResponse | undefined,
): ListBugFindingsResponse | undefined => {
  if (!v2 && !v1) return undefined;
  const ours = v2?.items ?? [];
  const reported = new Set(ours.map(f => f.reportedBugId).filter(Boolean));
  const history = (v1?.items ?? []).filter(
    f => !(f.reportedBugId && reported.has(f.reportedBugId)),
  );
  const items: BugFinding[] = [...ours, ...history];
  return { items, count: (v2?.count ?? 0) + history.length };
};

/** A button that acts on v2 for a v2 bug and on the old Bug Hunter for its own. */
export const byId =
  <A>(
    useV2: () => readonly [(arg: A) => unknown, { isLoading: boolean }],
    useV1: () => readonly [(arg: A) => unknown, { isLoading: boolean }],
  ) =>
  () => {
    const [v2Trigger, v2State] = useV2();
    const [v1Trigger, v1State] = useV1();
    const trigger = (arg: A) => (isV2Id(idOf(arg)) ? v2Trigger(arg) : v1Trigger(arg));
    return [trigger, { ...v2State, isLoading: v2State.isLoading || v1State.isLoading }] as const;
  };
