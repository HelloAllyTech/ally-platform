import React from "react";

import { AlertTriangle, Check, Clock, Minus, RefreshCw, type LucideIcon } from "lucide-react";

import { useGetContextRolloutQuery } from "@api";
import { en } from "@constants";
import type { ContextCollection, ContextRolloutStatus } from "@types";

import { errorReason } from "./contextLibraryFormat";
import { InlineError, LoadingRows, StatusWord } from "./ContextLibraryUi";
import { releaseStepCounts, releaseStepLabel, releaseStepWhen } from "./releaseStepsFormat";

const STATUS_ICON: Record<ContextRolloutStatus, LucideIcon> = {
  pending: Clock,
  running: RefreshCw,
  done: Check,
  failed: AlertTriangle,
  skipped: Minus,
};

const STATUS_TONE: Record<ContextRolloutStatus, "muted" | "warning" | "good" | "info"> = {
  pending: "muted",
  running: "info",
  done: "good",
  failed: "warning",
  skipped: "muted",
};

/** A refusal means this admin is not a platform admin: the section is not theirs to see. */
const isForbidden = (error: unknown): boolean =>
  typeof error === "object" && error !== null && (error as { status?: unknown }).status === 403;

/**
 * Settings → Release steps: read-only. Where each old corpus's move stands after a release —
 * import or enrichment, the replay of recent searches, and removal of the old corpus after the
 * grace period — with each step's status as an icon and a word, its counts, and when.
 */
export const ReleaseSteps: React.FC<{ collections: ContextCollection[] }> = ({ collections }) => {
  const strings = en.contextLibrary.releaseSteps;
  const { data, isLoading, isError, error, refetch } = useGetContextRolloutQuery(undefined, {
    pollingInterval: 60_000,
  });

  if (isError && isForbidden(error)) return null;

  const nameOf = (id: string) => collections.find(c => c.id === id)?.name ?? id;

  return (
    <section
      className="space-y-3"
      aria-labelledby="cl-release-steps"
      data-testid="cl-release-steps"
    >
      <h2 id="cl-release-steps" className="text-base font-semibold">
        {strings.title}
      </h2>
      {isLoading && <LoadingRows rows={3} />}
      {isError && (
        <InlineError
          what={strings.loadFailed}
          reason={errorReason(error)}
          onRetry={() => void refetch()}
        />
      )}
      {data && (
        <>
          <p className="max-w-3xl text-sm text-typography-600">
            {data.automatic ? strings.intro(data.retireAfterHours) : strings.manual}
          </p>
          <div className="grid gap-4 md:grid-cols-3">
            {data.corpora.map(corpus => (
              <div
                key={corpus.corpus}
                className="rounded border border-border-light p-3"
                data-testid="cl-release-corpus"
              >
                <h3 className="text-sm font-medium text-typography-900">
                  {strings.corpora[corpus.corpus] ?? corpus.corpus}
                </h3>
                <p className="text-xs text-typography-600">
                  {strings.into(nameOf(corpus.collectionId))}
                </p>
                <ol className="mt-2 space-y-2">
                  {corpus.steps.map(step => {
                    const counts = releaseStepCounts(step);
                    const when = releaseStepWhen(step, data.maxAttempts);
                    return (
                      <li key={step.step} className="text-sm" data-testid="cl-release-step">
                        <div className="flex flex-wrap items-center gap-x-2">
                          <StatusWord
                            icon={STATUS_ICON[step.status] ?? Clock}
                            tone={STATUS_TONE[step.status] ?? "muted"}
                            label={strings.statuses[step.status] ?? step.status}
                          />
                          <span className="text-typography-900">
                            {releaseStepLabel(step, data.retireAfterHours)}
                          </span>
                        </div>
                        {counts && <p className="text-xs text-typography-600">{counts}</p>}
                        {step.status === "failed" && step.lastError && (
                          <p className="text-xs text-amber-700">{step.lastError}</p>
                        )}
                        {when && <p className="text-xs text-typography-600">{when}</p>}
                      </li>
                    );
                  })}
                </ol>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
};
