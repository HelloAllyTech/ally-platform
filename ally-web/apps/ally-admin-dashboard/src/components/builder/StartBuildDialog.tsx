import React, { useEffect, useState } from "react";

import { toast } from "sonner";

import {
  Button,
  ComposedModal,
  FilterableMultiSelect,
  InlineNotification,
  ModalBody,
} from "@ally-ui-mono/ui-shared";
import {
  useGetBuilderRepoCommandsQuery,
  useStartBuilderBuildMutation,
  useUpdateBuilderSessionMutation,
} from "@api";
import { en } from "@constants";
import { BuilderPrdReadiness, BuilderRepoCommand } from "@types";

interface StartBuildDialogProps {
  isOpen: boolean;
  onClose: () => void;
  sessionId: string;
  /** `session.repos` — what the multi-select starts pre-checked with. */
  currentRepos: string[];
  readiness: BuilderPrdReadiness;
  /**
   * Set when opened as a retry from a FAILED build — swaps the copy and shows
   * what is being retried past. The request itself is identical: the backend
   * accepts start-build from either PRD_READY or FAILED.
   */
  retryError?: string | null;
  /**
   * Why the technical design stops this build, from `designBuildBlock`. A
   * block disables Start outright — unlike PRD readiness there is no "start
   * anyway": the backend refuses start-build until the design is approved and
   * fresh.
   */
  designBlock?: "notApproved" | "stale" | null;
  /**
   * Opens the technical design, where Approve and Redraft live. Without it a
   * blocked dialog names the fix and offers no way to it: once a session has
   * run, the PRD (and the design inside it) sits folded in a side rail.
   */
  onReviewDesign?: () => void;
  onStarted: () => void;
}

/**
 * Collects what a build needs before it can dispatch: which repos it touches.
 * Every build is an issue build — opencode runs in the monorepo's Actions, in
 * the service's folder, the model is one GitHub variable for every service,
 * and no cost is reported — so there is no budget or model to ask for here.
 *
 * Repos are saved onto the session (`updateBuilderSession`) before start-build
 * is called, not alongside it — the backend refuses to start a build with an
 * empty `session.repos`, and a PATCH-then-POST makes that ordering explicit
 * rather than relying on the mutation invalidation to race ahead of the read.
 *
 * When the PRD isn't fully ready, the dialog says so and offers "Start
 * anyway" rather than refusing outright — Builder can start and ask about a
 * genuinely open question mid-build, but a guess made at review time (after
 * code exists) costs a whole build to unwind. Naming what is still open here
 * is cheaper than finding out later.
 */
export const StartBuildDialog: React.FC<StartBuildDialogProps> = ({
  isOpen,
  onClose,
  sessionId,
  currentRepos,
  readiness,
  retryError,
  designBlock = null,
  onReviewDesign,
  onStarted,
}) => {
  const strings = en.builder.startBuildDialog;
  const isRetry = Boolean(retryError);

  const { data: repoCommandsData } = useGetBuilderRepoCommandsQuery();
  const repos = repoCommandsData?.repos ?? [];

  const [updateSession] = useUpdateBuilderSessionMutation();
  const [startBuild, { isLoading: isStarting }] = useStartBuilderBuildMutation();

  const [selectedRepos, setSelectedRepos] = useState<string[]>(currentRepos);
  const [reposError, setReposError] = useState(false);

  // Re-seed every time the dialog opens rather than once on mount — a second
  // open (e.g. retry after an earlier cancel) should reflect the session's
  // current repos, not whatever was left over from the last open.
  useEffect(() => {
    if (!isOpen) return;
    setSelectedRepos(currentRepos);
    setReposError(false);
  }, [isOpen, currentRepos]);

  const selectedRepoCommands = repos.filter(repo => selectedRepos.includes(repo.repo));
  const unreadySections = readiness.sections.filter(section => !section.ok);

  const handleSubmit = async () => {
    if (selectedRepos.length === 0) {
      setReposError(true);
      return;
    }

    try {
      await updateSession({ id: sessionId, repos: selectedRepos }).unwrap();
    } catch {
      toast.error(strings.saveReposFailed);
      return;
    }

    try {
      await startBuild({ id: sessionId }).unwrap();
      onStarted();
      onClose();
    } catch (error) {
      // The backend refusals each name which control stopped the build — the
      // kill switch, the concurrency ceiling, the budget — so surface the
      // server's own message rather than a generic one.
      const message =
        (error as { data?: { message?: string } })?.data?.message ?? en.builder.build.startFailed;
      toast.error(message);
    }
  };

  const submitLabel = isRetry
    ? strings.retrySubmit
    : readiness.ready
      ? en.builder.readiness.startBuild
      : en.builder.readiness.startBuildEarly;

  return (
    <ComposedModal open={isOpen} onClose={onClose} size="lg">
      <ModalBody>
        <div className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold text-typography-900">
            {isRetry ? strings.retryTitle : strings.title}
          </h2>

          {isRetry && retryError && (
            <InlineNotification
              kind="error"
              lowContrast
              hideCloseButton
              title={strings.retryIntro}
              subtitle={retryError}
            />
          )}

          {/* The action sits under the notification, not inside it: Carbon's InlineNotification
              throws on a control among its children (a notification is announced as one block of
              text, so a control in it is unreachable), and since this dialog stays mounted while
              closed, that took the whole session page down on load. Not ActionableNotification
              either, as BuildView uses: as an alertdialog it pulls focus to its button on every
              render and traps it there, which inside a form dialog would hold focus hostage. */}
          {designBlock && (
            <div>
              <InlineNotification
                kind="error"
                lowContrast
                hideCloseButton
                title={
                  designBlock === "stale"
                    ? strings.designStaleTitle
                    : strings.designNotApprovedTitle
                }
                subtitle={
                  designBlock === "stale" ? strings.designStaleBody : strings.designNotApprovedBody
                }
              />
              {onReviewDesign && (
                <Button kind="tertiary" size="sm" className="mt-2" onClick={onReviewDesign}>
                  {strings.reviewDesign}
                </Button>
              )}
            </div>
          )}

          {!readiness.ready && unreadySections.length > 0 && (
            <InlineNotification
              kind="warning"
              lowContrast
              hideCloseButton
              title={en.builder.readiness.startBuildBlockedTitle}
              subtitle={en.builder.readiness.startBuildBlockedBody}
            >
              <ul className="mt-1 list-disc pl-4 text-xs text-typography-700">
                {unreadySections.map(section => (
                  <li key={section.key}>{section.hint}</li>
                ))}
              </ul>
            </InlineNotification>
          )}

          <div>
            <div className="mb-1 flex items-center gap-1.5">
              <label
                className="text-sm font-medium text-typography-900"
                htmlFor="builder-start-repos"
              >
                {strings.reposLabel}
              </label>
            </div>
            <FilterableMultiSelect
              id="builder-start-repos"
              titleText=""
              placeholder={strings.reposPlaceholder}
              items={repos}
              itemToString={(item: BuilderRepoCommand | null) => item?.repo ?? ""}
              selectedItems={selectedRepoCommands}
              invalid={reposError}
              invalidText={strings.reposRequired}
              onChange={({ selectedItems }: { selectedItems: BuilderRepoCommand[] | null }) => {
                setReposError(false);
                setSelectedRepos((selectedItems ?? []).map(item => item.repo));
              }}
            />
            {selectedRepoCommands.length > 0 && (
              <ul className="mt-2 flex flex-col gap-1">
                {selectedRepoCommands.map(repo => (
                  <li key={repo.repo} className="text-xs text-typography-500">
                    <span className="font-medium text-typography-700">{repo.repo}</span>
                    {repo.description ? ` — ${repo.description}` : ""}
                  </li>
                ))}
              </ul>
            )}
            {/* Said in the open: the selection is not a boundary Builder
                enforces, and the order matters to whoever reviews the pull
                requests. */}
            <p className="mt-2 text-xs text-typography-600">{strings.reposHintIssue}</p>
          </div>

          <p className="text-xs text-typography-600">{strings.issueModelNote}</p>

          <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
            <Button kind="tertiary" className="max-sm:!w-full max-sm:!max-w-none" onClick={onClose}>
              {en.builder.prd.cancel}
            </Button>
            <Button
              kind="primary"
              className="max-sm:!w-full max-sm:!max-w-none"
              disabled={isStarting || Boolean(designBlock)}
              onClick={() => void handleSubmit()}
            >
              {submitLabel}
            </Button>
          </div>
        </div>
      </ModalBody>
    </ComposedModal>
  );
};
