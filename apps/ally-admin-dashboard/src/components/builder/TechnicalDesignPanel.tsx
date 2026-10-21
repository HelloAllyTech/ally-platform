import React, { useEffect, useRef, useState } from "react";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Button, InlineLoading, InlineNotification, Tag, Tooltip } from "@ally-ui-mono/ui-shared";
import {
  useApproveBuilderDesignMutation,
  useGetBuilderRunsQuery,
  useStartBuilderDesignMutation,
} from "@api";
import { TooltipIcon } from "@assets";
import { en } from "@constants";
import {
  BuilderDesignContract,
  BuilderDesignReadiness,
  BuilderDesignScope,
  BuilderDesignTest,
  BuilderTechnicalDesign,
} from "@types";
import { asAgentText, asAgentTextList, formatRelativeTime } from "@utils";

import { BuilderTagType } from "../../pages/Builder/builderMotion";
import { sharedMarkdownComponents } from "../markdown/markdownComponents";

/** Same reasoning as PrdDocPanel's: every list here is agent-written. */
const asArray = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

type DesignState = "none" | BuilderTechnicalDesign["status"];

const STATE_TAG_TYPE: Record<DesignState, BuilderTagType> = {
  none: "cool-gray",
  drafting: "blue",
  review: "purple",
  approved: "green",
  failed: "red",
};

interface TechnicalDesignPanelProps {
  sessionId: string;
  design: BuilderTechnicalDesign | null | undefined;
  designReadiness: BuilderDesignReadiness | null | undefined;
  /** The PRD's own readiness — a design is drafted from a finished PRD only. */
  prdReady: boolean;
  /** True while a build is running: the design is what it is working to. */
  locked?: boolean;
  /** Scroll to this panel when it mounts — it sits at the foot of a long PRD. */
  scrollIntoViewOnMount?: boolean;
}

/** The 400 message the backend sends names the real reason; prefer it. */
const errorMessage = (error: unknown, fallback: string): string => {
  const message = (error as { data?: { message?: unknown } })?.data?.message;
  if (Array.isArray(message)) return message.map(String).join(" ");
  return typeof message === "string" && message.trim() ? message : fallback;
};

/**
 * The technical design, under the PRD it was drafted from.
 *
 * A read-only agent explores the code and writes this; a second agent critiques
 * it; an admin approves it, and only then may a build start — the build is
 * held to its scope and test map. Editing the PRD afterwards makes it stale,
 * and a stale design has to be redrafted rather than approved.
 *
 * The design lives on the session row, which BuilderSession already polls, so
 * a drafting run's result appears here without its own subscription.
 */
export const TechnicalDesignPanel: React.FC<TechnicalDesignPanelProps> = ({
  sessionId,
  design,
  designReadiness,
  prdReady,
  locked = false,
  scrollIntoViewOnMount = false,
}) => {
  const strings = en.builder.design;
  const sectionRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (scrollIntoViewOnMount) sectionRef.current?.scrollIntoView?.({ block: "start" });
  }, [scrollIntoViewOnMount]);
  const [startDesign, { isLoading: isStarting }] = useStartBuilderDesignMutation();
  const [approveDesign, { isLoading: isApproving }] = useApproveBuilderDesignMutation();
  const [actionError, setActionError] = useState<string | null>(null);

  const state: DesignState = design?.status ?? "none";
  const isDrafting = state === "drafting";
  const stale = Boolean(designReadiness?.stale) && state !== "none";
  const ready = Boolean(designReadiness?.ready);
  const blockers = asAgentTextList(designReadiness?.blockers);

  // Only read while drafting: it is here for the "watch on GitHub" link.
  const { data: runs } = useGetBuilderRunsQuery(sessionId, {
    skip: !isDrafting || !design?.runId,
  });
  const designRun = runs?.find(run => run.id === design?.runId);

  const busy = isDrafting || isStarting || isApproving || locked;
  const canApprove = state === "review" && ready && !stale && !busy;
  const isRedraft = state === "review" || state === "approved" || state === "drafting" || stale;

  const handleDraft = async () => {
    setActionError(null);
    try {
      await startDesign(sessionId).unwrap();
    } catch (error) {
      setActionError(errorMessage(error, strings.draftFailed));
    }
  };

  const handleApprove = async () => {
    setActionError(null);
    try {
      await approveDesign(sessionId).unwrap();
    } catch (error) {
      setActionError(errorMessage(error, strings.approveFailed));
    }
  };

  const renderMarkdown = (raw: unknown, emptyText?: string) => {
    const value = asAgentText(raw);
    if (!value.trim()) {
      return emptyText ? (
        <p className="mt-1 text-sm italic text-typography-400">{emptyText}</p>
      ) : null;
    }
    return (
      <div className="prose prose-sm mt-1 max-w-none text-sm text-typography-800">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={sharedMarkdownComponents}>
          {value}
        </ReactMarkdown>
      </div>
    );
  };

  const sectionHeading = (label: string, hint?: string) => (
    <div className="flex items-center gap-1.5">
      <h4 className="text-sm font-semibold text-typography-900">{label}</h4>
      {hint && (
        <Tooltip label={hint} align="top">
          <button type="button" className="inline-flex cursor-pointer items-center">
            <TooltipIcon />
          </button>
        </Tooltip>
      )}
    </div>
  );

  const stateLabel: Record<DesignState, string> = {
    none: strings.statusNone,
    drafting: strings.statusDrafting,
    review: strings.statusReview,
    approved: strings.statusApproved,
    failed: strings.statusFailed,
  };

  const contracts = asArray<BuilderDesignContract>(design?.contracts);
  const scope = asArray<BuilderDesignScope>(design?.scope);
  const tests = asArray<BuilderDesignTest>(design?.testMap);
  const openDecisions = asAgentTextList(design?.openDecisions);
  const review = design?.review ?? null;
  // A failed or never-run design has no body worth showing.
  const hasBody = Boolean(design) && state !== "failed" && state !== "drafting";

  return (
    <section
      ref={sectionRef}
      aria-label={strings.heading}
      className="mt-2 border-t-2 border-neutral-200 pt-4"
      data-testid="technical-design-panel"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-typography-900">{strings.heading}</h3>
        <Tag type={STATE_TAG_TYPE[state]} size="sm">
          {stateLabel[state]}
        </Tag>
        {stale && (
          <Tooltip label={strings.staleHint} align="top">
            {/* Focusable so a tap (touch has no hover) can open the hint. */}
            <Tag type="warm-gray" size="sm" tabIndex={0}>
              {strings.stale}
            </Tag>
          </Tooltip>
        )}
      </div>

      {state === "approved" && design?.approvedAt && (
        <p className="mt-1 text-xs text-typography-500">
          {strings.approvedBy(formatRelativeTime(design.approvedAt))}
        </p>
      )}
      {state === "review" && design?.draftedAt && (
        <p className="mt-1 text-xs text-typography-500">
          {strings.draftedAt(formatRelativeTime(design.draftedAt))}
        </p>
      )}

      {state === "none" && <p className="mt-2 text-sm text-typography-600">{strings.none}</p>}

      {isDrafting && (
        <div className="mt-2 flex flex-col gap-1">
          <InlineLoading status="active" description={strings.statusDrafting} />
          <p className="text-sm text-typography-600">{strings.drafting}</p>
          {designRun?.githubRunUrl && (
            <a
              href={designRun.githubRunUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-primary-600 underline"
            >
              {strings.watchRun}
            </a>
          )}
        </div>
      )}

      {state === "failed" && (
        <div className="mt-2">
          <InlineNotification
            kind="error"
            lowContrast
            hideCloseButton
            title={strings.failed}
            subtitle={asAgentText(design?.error).trim() || strings.failedUnknown}
          />
        </div>
      )}

      {hasBody && (
        <div className="mt-3 flex flex-col gap-4">
          <div>
            {sectionHeading(strings.sections.design)}
            {renderMarkdown(design?.designMd, en.builder.prd.emptySection)}
          </div>

          <div>
            {sectionHeading(strings.sections.contracts)}
            {contracts.length ? (
              <ul className="mt-1 flex flex-col gap-2">
                {contracts.map((contract, index) => {
                  const readers = asAgentTextList(contract.readers);
                  return (
                    <li key={index} className="rounded border border-neutral-200 p-2 text-sm">
                      <p className="font-mono text-xs font-medium text-typography-900">
                        {asAgentText(contract.name)}
                      </p>
                      <p className="mt-1 text-typography-700">{asAgentText(contract.change)}</p>
                      {readers.length > 0 && (
                        <>
                          <p className="mt-2 text-xs font-medium tracking-wide text-typography-500">
                            {strings.contractReaders}
                          </p>
                          <ul className="mt-0.5 list-disc pl-5 font-mono text-xs text-typography-700">
                            {readers.map((reader, readerIndex) => (
                              <li key={readerIndex} className="break-all">
                                {reader}
                              </li>
                            ))}
                          </ul>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-1 text-sm italic text-typography-400">{strings.noContracts}</p>
            )}
          </div>

          <div>
            {sectionHeading(strings.sections.compatibility)}
            {renderMarkdown(design?.compatibilityMd, en.builder.prd.emptySection)}
          </div>

          <div>
            {sectionHeading(strings.sections.scope)}
            {scope.length ? (
              <ul className="mt-1 flex flex-col gap-2">
                {scope.map((entry, index) => {
                  const repo = asAgentText(entry.repo).trim();
                  const files = asAgentTextList(entry.files);
                  return (
                    <li key={`${repo || "repo"}-${index}`}>
                      <Tag type="purple" size="sm">
                        {repo || en.builder.prd.unnamedRepo}
                      </Tag>
                      <ul className="mt-1 pl-1 font-mono text-xs text-typography-700">
                        {files.map((file, fileIndex) => (
                          <li key={fileIndex} className="break-all">
                            {file}
                          </li>
                        ))}
                      </ul>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-1 text-sm italic text-typography-400">{strings.noScope}</p>
            )}
          </div>

          <div>
            {sectionHeading(strings.sections.tests)}
            {tests.length ? (
              <ul className="mt-1 flex flex-col gap-2">
                {tests.map((test, index) => (
                  <li key={index} className="rounded border border-neutral-200 p-2 text-sm">
                    <div className="flex flex-wrap items-baseline gap-2">
                      {asAgentText(test.requirementId) && (
                        <Tag type="blue" size="sm">
                          {asAgentText(test.requirementId)}
                        </Tag>
                      )}
                      <span className="break-all font-mono text-xs text-typography-700">
                        {[asAgentText(test.repo), asAgentText(test.file)]
                          .filter(Boolean)
                          .join(" / ")}
                      </span>
                    </div>
                    <p className="mt-1 text-typography-700">{asAgentText(test.asserts)}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-sm italic text-typography-400">{strings.noTests}</p>
            )}
          </div>

          <div>
            {sectionHeading(strings.sections.openDecisions, strings.openDecisionsHint)}
            {openDecisions.length ? (
              <ul className="mt-1 list-disc pl-5 text-sm text-typography-700">
                {openDecisions.map((decision, index) => (
                  <li key={index}>{decision}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-sm italic text-typography-400">{strings.noOpenDecisions}</p>
            )}
          </div>

          <div>
            <div className="flex items-center gap-2">
              {sectionHeading(strings.sections.reviewer)}
              {review && (
                <Tag type={review.verdict === "pass" ? "green" : "warm-gray"} size="sm">
                  {review.verdict === "pass" ? strings.reviewPass : strings.reviewConcerns}
                </Tag>
              )}
            </div>
            {review && (review.defects || review.suggestions) ? (
              // Split reviews: defects first, since they are what the verdict
              // means; suggestions separately, since they are scope calls for
              // a person rather than faults. notesMd repeats both for older
              // readers, so only what is left over is shown here.
              <div className="mt-1 flex flex-col gap-2">
                {[
                  { title: strings.reviewDefects, items: review.defects ?? [] },
                  { title: strings.reviewSuggestions, items: review.suggestions ?? [] },
                ]
                  .filter(group => group.items.length > 0)
                  .map(group => (
                    <div key={group.title}>
                      <p className="text-xs font-semibold text-typography-700">{group.title}</p>
                      <ul className="ml-4 list-disc text-sm text-typography-700">
                        {group.items.map((item, index) => (
                          <li key={index}>{renderMarkdown(item)}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
              </div>
            ) : review ? (
              renderMarkdown(review.notesMd)
            ) : (
              <p className="mt-1 text-sm italic text-typography-400">{strings.noReview}</p>
            )}
          </div>
        </div>
      )}

      {/* Blockers are the approve gate spelled out — irrelevant while there is
          nothing to approve yet, or while a draft is still being written. */}
      {prdReady && !ready && blockers.length > 0 && state !== "none" && !isDrafting && (
        <div className="mt-3">
          <InlineNotification
            kind="warning"
            lowContrast
            hideCloseButton
            title={strings.blockersTitle}
          >
            <ul className="mt-1 list-disc pl-4 text-xs text-typography-700">
              {blockers.map((blocker, index) => (
                <li key={index}>{blocker}</li>
              ))}
            </ul>
          </InlineNotification>
        </div>
      )}

      {actionError && (
        <div className="mt-3">
          <InlineNotification kind="error" lowContrast hideCloseButton title={actionError} />
        </div>
      )}

      {prdReady ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            kind={isRedraft ? "tertiary" : "primary"}
            size="sm"
            disabled={busy}
            onClick={() => void handleDraft()}
          >
            {isRedraft ? strings.redraft : strings.draft}
          </Button>
          <Tooltip label={isRedraft ? strings.redraftHint : strings.draftHint} align="top">
            <button type="button" className="inline-flex cursor-pointer items-center">
              <TooltipIcon />
            </button>
          </Tooltip>
          {state === "review" && (
            <>
              <Button
                kind="primary"
                size="sm"
                disabled={!canApprove}
                onClick={() => void handleApprove()}
              >
                {strings.approve}
              </Button>
              <Tooltip label={strings.approveHint} align="top">
                <button type="button" className="inline-flex cursor-pointer items-center">
                  <TooltipIcon />
                </button>
              </Tooltip>
            </>
          )}
        </div>
      ) : (
        <p className="mt-3 text-sm text-typography-600">{strings.prdNotReady}</p>
      )}
    </section>
  );
};
