import React, { useState } from "react";

import { toast } from "sonner";

import { Button, Tag, TextArea, Tooltip } from "@ally-ui-mono/ui-shared";
import { TooltipIcon } from "@assets";
import { en } from "@constants";
import { BuilderPrdReview, BuilderPrdReviewFinding } from "@types";

import { CollapsibleSection } from "./CollapsibleSection";

/** Matches the server's floor — a one-word reason teaches the reviewer nothing. */
export const DISMISS_REASON_MIN_CHARS = 10;

interface PrdReviewFindingsProps {
  /** Readiness's `review`: null before the first review, absent from older servers. */
  review: BuilderPrdReview | null | undefined;
  /** False while a build is reading the PRD — a dismissal changes what is buildable. */
  editable: boolean;
  onDismiss?: (findingId: string, reason: string) => Promise<void>;
}

/**
 * What the cold PRD reviewer found, at the top of the PRD.
 *
 * At the top because an open finding is what is stopping the build: the
 * readiness ring says how many things are left, and this says which ones and
 * how each clears. Every open finding names its fix, and the one thing the
 * admin can do here that the PRD cannot — say the reviewer is wrong — takes a
 * reason, because that reason is the record the reviewer is corrected from.
 *
 * Fixed and dismissed findings fold away rather than disappear: a dismissal
 * is a decision someone may want to revisit, and its reason is part of the
 * PRD's story.
 */
export const PrdReviewFindings: React.FC<PrdReviewFindingsProps> = ({
  review,
  editable,
  onDismiss,
}) => {
  const strings = en.builder.prd.review;
  const sectionNames = en.builder.prd.sections;
  const [dismissingId, setDismissingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!review) return null;

  const heading = (
    <div className="flex items-center gap-1.5">
      <h4 className="text-xs font-medium uppercase tracking-wide text-typography-500">
        {strings.heading}
      </h4>
      <Tooltip label={strings.tooltip} align="bottom">
        <button type="button" className="inline-flex cursor-pointer items-center">
          <TooltipIcon />
        </button>
      </Tooltip>
    </div>
  );

  if (review.status === "failed") {
    return (
      <section className="mb-4 rounded p-1" data-testid="prd-review">
        {heading}
        <p className="mt-1 text-sm text-typography-600">{strings.failed}</p>
      </section>
    );
  }

  const findings = Array.isArray(review.findings) ? review.findings : [];
  const open = findings.filter(finding => finding.status === "open");
  const resolved = findings.filter(finding => finding.status !== "open");

  const startDismiss = (id: string) => {
    setDismissingId(id);
    setReason("");
  };

  const confirmDismiss = async (id: string) => {
    if (!onDismiss) return;
    setSubmitting(true);
    try {
      await onDismiss(id, reason.trim());
      setDismissingId(null);
      setReason("");
    } catch {
      toast.error(strings.dismissFailed);
    } finally {
      setSubmitting(false);
    }
  };

  const renderOpen = (finding: BuilderPrdReviewFinding) => (
    <li key={finding.id} className="rounded border border-neutral-200 p-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="shrink-0">
          <Tag type="red" size="sm">
            {strings.categories[finding.category] ?? finding.category}
          </Tag>
        </span>
        <span className="text-xs text-typography-500">
          {strings.sectionLabel(sectionNames[finding.section] ?? finding.section)}
        </span>
      </div>
      <p className="mt-1 text-sm text-typography-900">{finding.detail}</p>
      {finding.quote && (
        <p className="mt-1 border-l-2 border-neutral-300 pl-2 text-xs italic text-typography-600">
          {finding.quote}
        </p>
      )}
      <p className="mt-1 text-sm text-typography-700">
        <span className="font-medium">{strings.fixLabel}</span> {finding.fix}
      </p>
      {finding.checkNote && <p className="mt-1 text-xs text-typography-500">{finding.checkNote}</p>}

      {editable && onDismiss && dismissingId !== finding.id && (
        <div className="mt-1 flex justify-end">
          <Button kind="ghost" size="sm" onClick={() => startDismiss(finding.id)}>
            {strings.dismiss}
          </Button>
        </div>
      )}
      {editable && onDismiss && dismissingId === finding.id && (
        <div className="mt-2 flex flex-col gap-2">
          <TextArea
            id={`prd-review-dismiss-${finding.id}`}
            labelText={strings.dismissPlaceholder}
            hideLabel
            placeholder={strings.dismissPlaceholder}
            helperText={strings.dismissHint(DISMISS_REASON_MIN_CHARS)}
            rows={2}
            value={reason}
            onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) =>
              setReason(event.target.value)
            }
          />
          <div className="flex justify-end gap-2">
            <Button
              kind="secondary"
              size="sm"
              disabled={submitting}
              onClick={() => setDismissingId(null)}
            >
              {en.builder.prd.cancel}
            </Button>
            <Button
              kind="primary"
              size="sm"
              disabled={submitting || reason.trim().length < DISMISS_REASON_MIN_CHARS}
              onClick={() => confirmDismiss(finding.id)}
            >
              {strings.confirmDismiss}
            </Button>
          </div>
        </div>
      )}
    </li>
  );

  const renderResolved = (finding: BuilderPrdReviewFinding) => (
    <li key={finding.id} className="flex items-start gap-2">
      <span className="shrink-0">
        <Tag type={finding.status === "fixed" ? "green" : "warm-gray"} size="sm">
          {finding.status === "fixed" ? strings.fixed : strings.dismissed}
        </Tag>
      </span>
      <span className="min-w-0 flex-1 text-sm text-typography-700">
        {finding.detail}
        {finding.dismissal?.reason && (
          <span className="mt-0.5 block text-xs text-typography-500">
            {strings.dismissedBecause(finding.dismissal.reason)}
          </span>
        )}
      </span>
    </li>
  );

  return (
    <section className="mb-4 rounded p-1" data-testid="prd-review">
      {heading}
      {open.length ? (
        <ul className="mt-1 flex flex-col gap-2">{open.map(renderOpen)}</ul>
      ) : (
        !resolved.length && (
          <p className="mt-1 text-sm italic text-typography-400">{strings.clean}</p>
        )
      )}
      {resolved.length > 0 && (
        <CollapsibleSection
          heading={strings.resolvedHeading(resolved.length)}
          defaultOpen={false}
          className="mt-2"
        >
          <ul className="mt-1 flex flex-col gap-1">{resolved.map(renderResolved)}</ul>
        </CollapsibleSection>
      )}
    </section>
  );
};
