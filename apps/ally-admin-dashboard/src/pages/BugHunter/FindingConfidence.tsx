import { FC } from "react";

import { Launch } from "@icons";

import { Tooltip } from "@ally-ui-mono/ui-shared";
import { TooltipIcon } from "@assets";
import { en } from "@constants";
import { BUG_FINDING_LOW_CONFIDENCE_THRESHOLD, BugFindingDetail } from "@types";
import { formatDateTime } from "@utils";

import { BUG_FINDING_MISS_REASON_LABELS, BUG_FINDING_MISS_SENSE_LABELS } from "./bugFindingLabels";

/** The drawer's help icon: one short sentence on hover, never a paragraph. */
export const InfoTip: FC<{ label: string }> = ({ label }) => (
  <Tooltip label={label} align="top">
    <button
      type="button"
      className="cursor-pointer inline-flex items-center -m-1 p-1 md:m-0 md:p-0"
    >
      <TooltipIcon />
    </button>
  </Tooltip>
);

/** One labelled line of a study or post-mortem. `emphasis` marks the line a retry acts on. */
export const DetailLine: FC<{
  label: string;
  value: string;
  mono?: boolean;
  emphasis?: boolean;
}> = ({ label, value, mono, emphasis }) => (
  <div>
    <p className="text-[11px] text-typography-500">{label}</p>
    <p
      className={`text-xs whitespace-pre-wrap break-words ${mono ? "font-mono" : ""} ${
        emphasis ? "text-typography-900 font-medium" : "text-typography-700"
      }`}
    >
      {value}
    </p>
  </div>
);

/**
 * Whether "How sure I am" has anything to say. An unproven finding with no
 * score counts: "nobody scored this" is a fact a reader must be able to tell
 * apart from a confident score, so it is never silently dropped.
 */
export const hasConfidenceDetails = (finding: BugFindingDetail): boolean =>
  finding.confidence != null ||
  !finding.proven ||
  finding.regressed ||
  Boolean(finding.regressionOf) ||
  Boolean(finding.miss) ||
  Boolean(finding.latestFixVerdict) ||
  Boolean(finding.independentVerification) ||
  Boolean(finding.pr) ||
  Boolean(finding.chain) ||
  Boolean(finding.faultLocation && finding.faultLocation.layer !== "unknown") ||
  Boolean(finding.budget);

/**
 * "How sure I am": everything Bug Hunter knows about how far to trust this
 * finding and its fix — the checkers' score, the independent verifier, the
 * case chain, where the fault was located, the Verifier's verdict on the PR,
 * the budget, and the miss and regression record.
 *
 * Evidence about the finding rather than an action on it, so it lives in a
 * collapsed section under the decision instead of between the reader and it.
 */
export const FindingConfidence: FC<{ finding: BugFindingDetail }> = ({ finding }) => (
  <div className="flex flex-col gap-3">
    {finding.confidence != null && (
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-typography-700">{en.bugHunter.drawerConfidenceLabel}:</span>
        <span
          className={`text-xs font-medium tabular-nums ${
            finding.confidence < BUG_FINDING_LOW_CONFIDENCE_THRESHOLD
              ? "text-amber-700"
              : "text-typography-900"
          }`}
        >
          {Math.round(finding.confidence * 100)}%
        </span>
        <InfoTip label={en.bugHunter.drawerConfidenceTooltip} />
        {finding.confidence < BUG_FINDING_LOW_CONFIDENCE_THRESHOLD && (
          <span className="text-[11px] text-amber-700">
            {en.bugHunter.findingLowConfidenceTooltip}
          </span>
        )}
      </div>
    )}

    {/* An unproven finding with no score is a different fact from a proven one
        with no score, and neither is "0% confident". */}
    {finding.confidence == null && !finding.proven && (
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-typography-600">{en.bugHunter.drawerConfidenceUnscored}</span>
        <InfoTip label={en.bugHunter.drawerConfidenceUnscoredTooltip} />
      </div>
    )}

    {/* A finding from a PR review run (OPP-0785): the PR it is about. */}
    {finding.pr && (
      <div data-testid="finding-pr" className="flex items-center gap-1 text-xs">
        <a
          href={finding.pr.commentUrl ?? finding.pr.url}
          target="_blank"
          rel="noreferrer"
          className="text-primary-600 underline inline-flex items-center gap-1"
        >
          {en.bugHunter.drawerPrReview.replace("{number}", String(finding.pr.number))}
          <Launch aria-hidden="true" />
        </a>
        {finding.pr.commentUrl && (
          <span className="text-typography-600">{en.bugHunter.drawerPrReviewCommented}</span>
        )}
      </div>
    )}

    {/* Where the independent finding verifier stands (OPP-0780). */}
    {finding.independentVerification && (
      <div data-testid="independent-verification" className="flex items-center gap-1">
        <span
          className={`text-xs font-medium ${
            finding.independentVerification === "confirmed"
              ? "text-green-700"
              : finding.independentVerification === "pending"
                ? "text-typography-600"
                : "text-amber-700"
          }`}
        >
          {finding.independentVerification === "pending"
            ? en.bugHunter.drawerIndependentPending
            : finding.independentVerification === "confirmed"
              ? en.bugHunter.drawerIndependentConfirmed
              : finding.independentVerification === "refuted"
                ? en.bugHunter.drawerIndependentRefuted
                : en.bugHunter.drawerIndependentUnsure}
        </span>
        <InfoTip label={en.bugHunter.drawerIndependentTooltip} />
      </div>
    )}

    {/* The case chain (2026-10-12): six links from the symptom to the change.
        A missing or broken link is what a wrong-layer fix looks like before
        it merges. */}
    {finding.chain && (
      <div data-testid="case-chain" className="flex flex-col gap-1">
        <div className="flex items-center gap-1">
          <p className="text-xs font-medium text-typography-900">{en.bugHunter.drawerChainTitle}</p>
          <InfoTip label={en.bugHunter.drawerChainTooltip} />
        </div>
        <ol className="flex flex-col gap-0.5">
          {finding.chain.links.map(l => (
            <li
              key={l.link}
              data-testid={`chain-${l.link}`}
              data-status={l.status}
              className="flex items-start gap-2 text-xs"
            >
              <span
                aria-hidden="true"
                className={`mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-full ${
                  l.status === "present"
                    ? "bg-green-600"
                    : l.status === "weak"
                      ? "bg-amber-400"
                      : l.status === "broken"
                        ? "bg-red-600"
                        : "border border-gray-400 bg-transparent"
                }`}
              />
              <span className="min-w-0">
                <span className="font-medium text-typography-900">
                  {en.bugHunter.drawerChainLinks[l.link]}
                </span>{" "}
                <span className="text-typography-600">
                  {en.bugHunter.drawerChainStatus[l.status]}
                  {l.evidence ? ` — ${l.evidence}` : ""}
                </span>
              </span>
            </li>
          ))}
        </ol>
      </div>
    )}

    {/* Where the verifier located the fault (locate before fixing,
        2026-10-12), and the reason a data or config fault never gets a
        session. */}
    {finding.faultLocation && finding.faultLocation.layer !== "unknown" && (
      <div
        data-testid="fault-location"
        className={`flex flex-col gap-1 rounded border p-2 ${
          finding.faultLocation.layer === "code"
            ? "border-border-light bg-neutral-50"
            : "border-amber-200 bg-amber-50"
        }`}
      >
        <p className="text-xs font-medium text-typography-900">
          {(finding.faultLocation.repo
            ? en.bugHunter.drawerFaultLocatedRepo
            : en.bugHunter.drawerFaultLocated
          )
            .replace("{layer}", finding.faultLocation.layer)
            .replace("{repo}", finding.faultLocation.repo ?? "")}
        </p>
        {finding.faultLocation.evidence && (
          <DetailLine
            label={en.bugHunter.drawerFaultEvidence}
            value={finding.faultLocation.evidence}
            mono
          />
        )}
        {finding.faultLocation.repair && (
          <DetailLine
            label={en.bugHunter.drawerFaultRepair}
            value={finding.faultLocation.repair}
            emphasis
          />
        )}
        {finding.faultLocation.layer !== "code" && (
          <p className="text-[11px] text-amber-800">{en.bugHunter.drawerFaultDataNote}</p>
        )}
      </div>
    )}

    {/* The Verifier's verdict on the current fix PR (OPP-0779). */}
    {finding.latestFixVerdict && (
      <div data-testid="fix-verdict" className="flex flex-col gap-0.5">
        <div className="flex items-center gap-1">
          <span
            className={`text-xs font-medium ${
              finding.latestFixVerdict.verdict === "pass" ? "text-green-700" : "text-amber-700"
            }`}
          >
            {finding.latestFixVerdict.verdict === "pass"
              ? en.bugHunter.drawerVerdictPass
              : en.bugHunter.drawerVerdictFail}
          </span>
          {finding.latestFixVerdict.by.engine && (
            <span className="text-xs text-typography-600">
              ·{" "}
              {en.bugHunter.drawerVerdictBy.replace("{engine}", finding.latestFixVerdict.by.engine)}
            </span>
          )}
          <InfoTip label={en.bugHunter.drawerVerdictTooltip} />
        </div>
        {finding.latestFixVerdict.summary && (
          <p className="text-xs text-typography-700">{finding.latestFixVerdict.summary}</p>
        )}
        <ul className="text-xs text-typography-600 flex flex-col gap-0.5">
          {finding.latestFixVerdict.checks.map(check => (
            <li key={check.name} className="flex gap-1.5">
              <span className={`font-mono ${check.ok === false ? "text-amber-700" : ""}`}>
                {check.skipped ? "–" : check.ok ? "✓" : "✗"}
              </span>
              <span className="font-mono">{check.name}</span>
              <span className="min-w-0 break-words">
                {check.skipped
                  ? en.bugHunter.drawerVerdictCheckSkipped.replace("{reason}", check.skipped)
                  : (check.evidence ?? "")}
              </span>
            </li>
          ))}
        </ul>
      </div>
    )}

    {/* The case file's budget (OPP-0775): what this bug has cost so far
        against its caps. "Nothing spent" is itself a fact worth having before
        pressing Start. */}
    {finding.budget && (
      <div data-testid="budget" className="flex flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-xs text-typography-700">{en.bugHunter.drawerBudgetLabel}:</span>
          <span className="text-xs font-medium tabular-nums text-typography-900">
            {en.bugHunter.drawerBudgetSummary
              .replace("{sessions}", String(finding.budget.used.sessions))
              .replace("{sessionsCap}", String(finding.budget.caps.sessions))
              .replace("{attempts}", String(finding.budget.used.attempts))
              .replace("{attemptsCap}", String(finding.budget.caps.attempts))
              .replace("{usd}", finding.budget.used.usd.toFixed(2))
              .replace("{usdCap}", finding.budget.caps.usd.toFixed(2))}
          </span>
          <InfoTip label={en.bugHunter.drawerBudgetTooltip} />
        </div>
        {finding.budget.exhausted && (
          <p className="text-xs text-amber-700">
            {en.bugHunter.drawerBudgetExhausted.replace("{kind}", finding.budget.exhausted.kind)}
          </p>
        )}
        {finding.budget.overriddenAt && (
          <p className="text-xs text-typography-600">
            {en.bugHunter.drawerBudgetOverridden.replace(
              "{date}",
              formatDateTime(finding.budget.overriddenAt),
            )}
          </p>
        )}
      </div>
    )}

    {/* The miss record (OPP-0774): on a reported bug, why Bug Hunter did not
        find it first and which sense would have. */}
    {finding.miss && (
      <div data-testid="miss-record" className="flex flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-xs text-typography-700">{en.bugHunter.drawerMissTitle}:</span>
          <span className="text-xs font-medium text-typography-900">
            {BUG_FINDING_MISS_REASON_LABELS[finding.miss.reason] ?? finding.miss.reason}
          </span>
          <InfoTip label={en.bugHunter.drawerMissTooltip} />
        </div>
        {finding.miss.sense && (
          <p className="text-xs text-typography-600">
            {en.bugHunter.drawerMissWouldNeed.replace(
              "{sense}",
              BUG_FINDING_MISS_SENSE_LABELS[finding.miss.sense] ?? finding.miss.sense,
            )}
          </p>
        )}
        {finding.miss.rationale && (
          <p className="text-xs text-typography-600 whitespace-pre-wrap">
            {finding.miss.rationale}
          </p>
        )}
        {finding.miss.matchedFindingId && (
          <a
            href={`?bug=${finding.miss.matchedFindingId}`}
            className="text-xs text-primary-600 underline w-fit"
          >
            {en.bugHunter.drawerMissSeeMatched}
          </a>
        )}
      </div>
    )}

    {finding.regressionOf && (
      <a href={`?bug=${finding.regressionOf}`} className="text-xs text-primary-600 underline w-fit">
        {en.bugHunter.drawerRegressionOfLink}
      </a>
    )}

    {finding.regressed && (
      <p className="text-xs text-amber-700">{en.bugHunter.findingRegressedTooltip}</p>
    )}
  </div>
);
