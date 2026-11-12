import React, { useState } from "react";

import { Link } from "react-router-dom";
import { toast } from "sonner";

import { Button } from "@ally-ui-mono/ui-shared";
import { useGetDebriefReleasesQuery, useRollbackDebriefReleaseMutation } from "@api";
import { formatUsd, releaseVersionLabel } from "@components/ally-guide/allyGuideFormat";
import { ConfirmDialog } from "@components/ally-guide/ConfirmDialog";
import { EmptyPanel, ErrorPanel, LoadingBlock } from "@components/ally-guide/ConsoleStates";
import { en } from "@constants";
import { DebriefOverview, DebriefReleaseRow, PmAgentIdeaRow } from "@types";
import { getErrorMessage } from "@utils";

import { codeWords, inWords, releaseStatusLabel } from "../consoleLabels";
import { pmAgentPath } from "../consoleRoutes";
import { score } from "../consoleTable";
import { ConsoleTag } from "../consoleUi";
import { ideaCode } from "./IdeaCard";
import { StepsAndModels } from "./StepsAndModels";

const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "—";

/** PM agent › Releases: the live release with its steps and models, then every other version. */
export const ReleasesView: React.FC<{
  canAct: boolean;
  ideas: PmAgentIdeaRow[];
  overview: DebriefOverview | undefined;
}> = ({ canAct, ideas, overview }) => {
  const s = en.debriefs.releases;
  const p = en.debriefs.pmPage.releases;
  const releases = useGetDebriefReleasesQuery();
  const [rollback, { isLoading }] = useRollbackDebriefReleaseMutation();
  const [target, setTarget] = useState<DebriefReleaseRow | null>(null);

  const confirm = async () => {
    if (!target) return;
    try {
      await rollback({ id: target.id }).unwrap();
      toast.success(s.rolledBack);
      setTarget(null);
    } catch (e) {
      toast.error(getErrorMessage(e, s.rollbackFailed));
    }
  };

  if (releases.isError) {
    return (
      <ErrorPanel
        what={s.loadFailed}
        error={releases.error}
        onRetry={() => void releases.refetch()}
      />
    );
  }
  if (!releases.data) return <LoadingBlock lines={6} />;
  const live = releases.data.find(r => r.status === "ga");
  const others = releases.data.filter(r => r !== live);
  const ideaFor = (r: DebriefReleaseRow) => ideas.find(i => i.releaseVersion === r.version);
  const tone = (r: DebriefReleaseRow) => (r.status === "canary" ? "info" : "neutral");

  return (
    <div className="flex max-w-[1160px] flex-col gap-6 px-8 py-7" data-testid="releases-view">
      {live ? (
        <article
          className="flex flex-col gap-4 rounded-sm bg-neutral-50 px-[26px] py-[22px]"
          data-testid="live-release"
        >
          <div className="flex flex-wrap items-center gap-2.5">
            <ConsoleTag tone="success">{s.live}</ConsoleTag>
            <span className="text-[13px] text-neutral-600">
              {p.since(
                day(live.promotedAt ?? live.createdAt),
                s.authors[live.authorKind] ?? codeWords(live.authorKind),
              )}
            </span>
          </div>
          <h2 className="text-[22px] font-semibold">
            {releaseVersionLabel(live.version)}
            {live.notes ? ` · ${live.notes}` : ""}
          </h2>
          {overview && (
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-neutral-700">
              <span>{p.judge(score(overview.judge.mean), overview.judge.scored)}</span>
              <span>{p.cost(formatUsd(overview.costUsd.p50))}</span>
            </div>
          )}
          <StepsAndModels canEdit={canAct} />
        </article>
      ) : (
        <EmptyPanel title={s.heading} message={s.empty} />
      )}

      <section className="flex flex-col gap-2.5" data-testid="releases-versions">
        <h2 className="text-xs font-semibold tracking-[.32px] text-neutral-600">
          {p.otherVersions}
        </h2>
        {others.length === 0 && <p className="text-sm text-neutral-600">{p.noOthers}</p>}
        {others.map(r => {
          const idea = ideaFor(r);
          return (
            <div
              key={r.id}
              data-testid="release-row"
              className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-sm bg-neutral-50 px-5 py-4"
            >
              <ConsoleTag tone={tone(r)}>{releaseStatusLabel(r.status)}</ConsoleTag>
              <div className="min-w-0 flex-[1_1_320px]">
                <div className="text-[15px] font-semibold">
                  {releaseVersionLabel(r.version)}
                  {idea ? ` · ${inWords(idea.title)}` : ""}
                </div>
                {r.notes && <div className="text-[13px] text-neutral-600">{r.notes}</div>}
              </div>
              <span className="text-[13px] text-neutral-600">
                {s.authors[r.authorKind] ?? codeWords(r.authorKind)} ·{" "}
                {day(r.promotedAt ?? r.createdAt)}
              </span>
              {idea && (
                <Link to={pmAgentPath("ideas", idea.id)} className="text-[13px]">
                  {p.fromIdea(ideaCode(idea))}
                </Link>
              )}
              {canAct && r.status !== "canary" && (
                <Button kind="tertiary" size="sm" onClick={() => setTarget(r)}>
                  {p.rollBack}
                </Button>
              )}
            </div>
          );
        })}
      </section>

      <ConfirmDialog
        isOpen={target !== null}
        title={target ? s.rollbackTitle(releaseVersionLabel(target.version)) : ""}
        cancelLabel={en.debriefs.pmAgent.cancel}
        confirmLabel={s.rollbackConfirm}
        isWorking={isLoading}
        onConfirm={() => void confirm()}
        onClose={() => setTarget(null)}
      >
        <p>{s.rollbackBody}</p>
      </ConfirmDialog>
    </div>
  );
};
