import React, { useState } from "react";

import { Link } from "react-router-dom";

import { Button, InlineNotification, Modal, SkeletonText, Tooltip } from "@ally-ui-mono/ui-shared";
import { useGetRoadmapCutoverPreviewQuery, useRunRoadmapCutoverMutation } from "@api";
import { TooltipIcon } from "@assets";
import { ROUTES, en } from "@constants";
import type { RoadmapCutoverPerson, RoadmapCutoverPreview, RoadmapCutoverResult } from "@types";

import { shortDate } from "../utils/copy";

const t = () => en.roadmapV2Cutover;

/** How many names a list shows before "and N more". */
const LIST_MAX = 8;

const statusOf = (error: unknown): number | null => {
  const status = (error as { status?: unknown } | undefined)?.status;
  return typeof status === "number" ? status : null;
};

/** Whether there is anything for a run to move (a catch-up run with nothing to do is pointless). */
export const somethingToMove = (preview: RoadmapCutoverPreview): boolean =>
  preview.drafts.total + preview.sessions.total + preview.reviewBackfill.total > 0;

const Help: React.FC<{ label: string }> = ({ label }) => (
  <Tooltip label={label} align="top">
    <button type="button" className="inline-flex cursor-pointer items-center" aria-label={label}>
      <TooltipIcon />
    </button>
  </Tooltip>
);

const People: React.FC<{ title: string; people: RoadmapCutoverPerson[] }> = ({ title, people }) => {
  const copy = t();
  return (
    <div className="flex flex-col gap-1">
      <h4 className="m-0 text-sm font-medium text-typography-900">{title}</h4>
      {people.length ? (
        <ul className="m-0 flex list-none flex-wrap gap-x-3 gap-y-1 p-0 text-sm text-typography-600">
          {people.map(p => (
            <li key={p.userId}>{p.name}</li>
          ))}
        </ul>
      ) : (
        <p className="m-0 text-sm text-typography-600">{copy.nobody}</p>
      )}
    </div>
  );
};

const Sample: React.FC<{ items: string[]; total: number }> = ({ items, total }) => {
  const copy = t();
  if (!items.length) return null;
  const shown = items.slice(0, LIST_MAX);
  const more = total - shown.length;
  return (
    <ul className="m-0 mt-1 list-disc pl-5 text-xs text-typography-600">
      {shown.map((line, i) => (
        <li key={`${line}-${i}`}>{line}</li>
      ))}
      {more > 0 && <li>{copy.more(more)}</li>}
    </ul>
  );
};

/** The confirm step names what will happen, and that switching off brings the old tabs back. */
const ConfirmBody: React.FC<{ preview: RoadmapCutoverPreview }> = ({ preview }) => {
  const copy = t();
  return (
    <ul className="m-0 flex list-disc flex-col gap-2 pl-5 text-sm text-typography-900">
      {!preview.roadmapV2Enabled && <li>{copy.confirmEveryone}</li>}
      {preview.drafts.total > 0 && <li>{copy.drafts(preview.drafts.total)}.</li>}
      {preview.sessions.total > 0 && preview.goal && (
        <li>{copy.sessions(preview.sessions.total, preview.goal)}.</li>
      )}
      {preview.reviewBackfill.total > 0 && <li>{copy.reviews(preview.reviewBackfill.total)}.</li>}
      <li>{copy.confirmKept}</li>
    </ul>
  );
};

const Done: React.FC<{ result: RoadmapCutoverResult }> = ({ result }) => {
  const copy = t();
  return (
    <div
      role="status"
      className="flex flex-col gap-2 rounded-md border border-border-light bg-neutral-50 p-4"
    >
      <p className="m-0 text-sm font-semibold text-typography-900">{copy.doneTitle}</p>
      <p className="m-0 text-sm text-typography-600">
        {copy.doneSummary(
          result.counts.draftsMoved,
          result.counts.sessionsFiled,
          result.counts.reviewsAccepted,
        )}
      </p>
      <div>
        <Link to={ROUTES.ROADMAP} className="text-sm font-medium text-primary-700 underline">
          {copy.openRoadmap}
        </Link>
      </div>
    </div>
  );
};

/**
 * Switch on Roadmap (Roadmap v2 P6, plans/roadmap-builder-merge §3.3, §6, D8). Owner only: anyone
 * else gets 403 from the preview, and the section renders nothing. It lives on Builder settings
 * because the Roadmap's own pages 404 until the flag is on, and on Roadmap → Settings afterwards,
 * where a second run moves anything made through the old pages since (it is idempotent).
 *
 * One primary action [FP-1461]; the confirm names each consequence before it happens [FP-2214]
 * and says plainly that nothing is deleted and switching off brings the old tabs back [FP-1743].
 */
export const RoadmapSwitchOnSection: React.FC = () => {
  const copy = t();
  const {
    data: preview,
    error,
    isLoading,
    isFetching,
    refetch,
  } = useGetRoadmapCutoverPreviewQuery();
  const [run, { isLoading: running }] = useRunRoadmapCutoverMutation();
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<RoadmapCutoverResult | null>(null);
  const [problem, setProblem] = useState<"conflict" | "failed" | "noGoal" | null>(null);

  const status = statusOf(error);
  // Not an Owner (403), or a backend without the route (404): nothing to show.
  if (status === 403 || status === 404) return null;

  const heading = (
    <div>
      <h2 id="roadmap-switch-on" className="m-0 text-lg font-semibold text-typography-900">
        {copy.title}
      </h2>
      {preview && (
        <p className="m-0 text-sm text-typography-600">
          {preview.roadmapV2Enabled ? copy.introOn : copy.intro}
        </p>
      )}
    </div>
  );

  if (isLoading) {
    return (
      <section aria-labelledby="roadmap-switch-on" aria-busy="true" className="flex flex-col gap-3">
        {heading}
        <p className="sr-only">{copy.loading}</p>
        <SkeletonText paragraph lineCount={4} />
      </section>
    );
  }

  if (!preview) {
    return (
      <section aria-labelledby="roadmap-switch-on" className="flex flex-col gap-3">
        {heading}
        <InlineNotification kind="error" lowContrast hideCloseButton title={copy.loadFailed} />
        <div>
          <Button kind="tertiary" size="sm" onClick={() => void refetch()}>
            {copy.retry}
          </Button>
        </div>
      </section>
    );
  }

  const on = preview.roadmapV2Enabled;
  const anything = somethingToMove(preview);
  const blockedByGoal = preview.sessions.total > 0 && !preview.goal;
  const canRun = !running && !isFetching && !blockedByGoal && (!on || anything);

  const submit = async () => {
    setConfirming(false);
    setProblem(null);
    try {
      const done = await run({
        confirmedBuilderIds: preview.builders.map(p => p.userId),
        confirmedOwnerIds: preview.owners.map(p => p.userId),
      }).unwrap();
      setResult(done);
    } catch (err) {
      const code = statusOf(err);
      const body = (err as { data?: { code?: string } } | undefined)?.data;
      if (code === 409) {
        setProblem("conflict");
        void refetch();
      } else if (code === 422 && body?.code === "no_goal") {
        setProblem("noGoal");
      } else {
        setProblem("failed");
      }
    }
  };

  return (
    <section aria-labelledby="roadmap-switch-on" className="flex flex-col gap-4">
      {heading}

      {result && <Done result={result} />}
      {problem === "conflict" && (
        <InlineNotification kind="warning" lowContrast hideCloseButton title={copy.conflict} />
      )}
      {problem === "failed" && (
        <InlineNotification kind="error" lowContrast hideCloseButton title={copy.failed} />
      )}
      {(problem === "noGoal" || blockedByGoal) && (
        <InlineNotification kind="warning" lowContrast hideCloseButton title={copy.noGoal} />
      )}

      <div className="flex flex-col gap-3 rounded-md border border-border-light bg-white p-4">
        <div className="flex items-center gap-1.5">
          <h3 className="m-0 text-base font-semibold text-typography-900">{copy.rolesTitle}</h3>
          <Help label={copy.rolesHelp} />
        </div>
        <People title={copy.owners(preview.owners.length)} people={preview.owners} />
        <People title={copy.builders(preview.builders.length)} people={preview.builders} />
        {preview.withoutRoadmapAccess.length > 0 && (
          <p className="m-0 text-sm text-typography-900">
            {copy.withoutAccess(preview.withoutRoadmapAccess.map(p => p.name).join(", "))}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2 rounded-md border border-border-light bg-white p-4">
        <h3 className="m-0 text-base font-semibold text-typography-900">{copy.movesTitle}</h3>
        {anything ? (
          <ul className="m-0 flex list-none flex-col gap-3 p-0 text-sm text-typography-900">
            {preview.drafts.total > 0 && (
              <li>
                {copy.drafts(preview.drafts.total)}
                <Sample
                  total={preview.drafts.total}
                  items={preview.drafts.items.map(d => `${d.title} (${d.authorName})`)}
                />
              </li>
            )}
            {preview.sessions.total > 0 && (
              <li>
                <span className="inline-flex items-center gap-1.5">
                  {copy.sessions(preview.sessions.total, preview.goal ?? "—")}
                  <Help label={copy.sessionsHelp} />
                </span>
                <Sample
                  total={preview.sessions.total}
                  items={preview.sessions.items.map(s => `${s.title} (${s.creatorName})`)}
                />
              </li>
            )}
            {preview.reviewBackfill.total > 0 && (
              <li>{copy.reviews(preview.reviewBackfill.total)}</li>
            )}
          </ul>
        ) : (
          <p className="m-0 text-sm text-typography-600">{copy.nothingToMove}</p>
        )}
      </div>

      {/* After a switch-on from Builder settings the old page redirects here, so the last run's
          summary is what tells the Owner what moved. */}
      {preview.lastRun && (
        <p className="m-0 text-xs text-typography-600" data-testid="roadmap-switch-on-last-run">
          {copy.lastRun(shortDate(preview.lastRun.at), preview.lastRun.actorName)}{" "}
          {copy.doneSummary(
            preview.lastRun.counts?.draftsMoved ?? 0,
            preview.lastRun.counts?.sessionsFiled ?? 0,
            preview.lastRun.counts?.reviewsAccepted ?? 0,
          )}
        </p>
      )}

      {(!on || anything) && (
        <div>
          <Button kind="primary" size="md" disabled={!canRun} onClick={() => setConfirming(true)}>
            {running ? copy.running : on ? copy.moveLeft : copy.switchOn}
          </Button>
        </div>
      )}

      {/* Mounted only while asked, so the closed dialog's buttons never shadow the page's. */}
      {confirming && (
        <Modal
          open
          size="sm"
          modalHeading={on ? copy.confirmTitleOn : copy.confirmTitle}
          primaryButtonText={on ? copy.confirmOn : copy.confirm}
          secondaryButtonText={copy.cancel}
          primaryButtonDisabled={running}
          onRequestClose={() => setConfirming(false)}
          onRequestSubmit={() => void submit()}
        >
          <ConfirmBody preview={preview} />
        </Modal>
      )}
    </section>
  );
};
