import React, { useState } from "react";

import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { Button, InlineNotification, SkeletonText, Tile } from "@ally-ui-mono/ui-shared";
import {
  useArchiveCourseCopilotSessionMutation,
  useCreateCourseCopilotSessionMutation,
  useGetCourseCopilotSessionsQuery,
} from "@api";
import { ActionConfirmationPopup } from "@components/action-confirmation-popup";
import { ButtonVariant } from "@components/types";
import { en, LOCAL_STORAGE_KEYS, ROUTES } from "@constants";
import { CourseCopilotSessionSummary } from "@types";

import { errorMessageFrom } from "./courseCopilotErrors";
import { CourseCopilotStatusTag } from "./CourseCopilotStatusTag";

/** Archiving a session that is mid-build is left to the build's own cancel — see the session page. */
const ARCHIVABLE = (session: CourseCopilotSessionSummary) => session.status !== "BUILDING";

const formatUpdated = (iso: string): string => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
};

/**
 * The caller's Course Copilot sessions: resume one, archive one, or start a new course.
 *
 * Archiving closes the conversation and never touches the course, which the confirm dialog says in
 * so many words — "archive" next to a course invites exactly the wrong fear.
 */
export const CourseCopilotSessions: React.FC = () => {
  const strings = en.courseCopilot;
  const navigate = useNavigate();

  // Sessions move on their own (a build finishes while the tab is in the background), and a stale
  // list is how a finished build goes unnoticed. Cheap: the list is small and non-archived only.
  const {
    data: sessions,
    isLoading,
    isError,
  } = useGetCourseCopilotSessionsQuery(undefined, {
    pollingInterval: 15000,
    skipPollingIfUnfocused: true,
  });
  const [createSession, { isLoading: isCreating }] = useCreateCourseCopilotSessionMutation();
  const [archiveSession] = useArchiveCourseCopilotSessionMutation();
  const [archiveTarget, setArchiveTarget] = useState<CourseCopilotSessionSummary | null>(null);

  const open = (id: string) => navigate(ROUTES.COURSE_COPILOT_SESSION(id));

  const handleNewCourse = async () => {
    try {
      const session = await createSession().unwrap();
      open(session.id);
    } catch (error) {
      // A 409 carries the cap message ("you already have two active sessions…") — show it as is.
      toast.error(errorMessageFrom(error, strings.list.createFailed));
    }
  };

  const handleConfirmArchive = async () => {
    const target = archiveTarget;
    setArchiveTarget(null);
    if (!target) return;
    try {
      await archiveSession(target.id).unwrap();
      if (localStorage.getItem(LOCAL_STORAGE_KEYS.COURSE_COPILOT_SESSION_ID) === target.id) {
        localStorage.removeItem(LOCAL_STORAGE_KEYS.COURSE_COPILOT_SESSION_ID);
      }
      toast.success(strings.list.archiveSuccess);
    } catch {
      toast.error(strings.list.archiveFailed);
    }
  };

  // The server returns newest first; an array guard keeps a malformed response from crashing the page.
  const rows = Array.isArray(sessions) ? sessions : [];

  return (
    <div className="mx-auto w-full max-w-4xl p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl text-typography-900 md:text-2xl">{strings.title}</h1>
          <p className="mt-1 text-sm text-typography-600">{strings.list.subtitle}</p>
        </div>
        <Button
          kind="primary"
          size="md"
          disabled={isCreating}
          onClick={() => void handleNewCourse()}
        >
          {strings.newCourse}
        </Button>
      </div>

      <div className="mt-6">
        {isLoading ? (
          <SkeletonText paragraph lineCount={4} />
        ) : isError ? (
          <InlineNotification
            kind="error"
            lowContrast
            hideCloseButton
            title={strings.list.loadFailed}
          />
        ) : rows.length === 0 ? (
          <Tile>
            <p className="text-sm text-typography-700">{strings.list.empty}</p>
          </Tile>
        ) : (
          <ul className="flex flex-col gap-3">
            {rows.map(session => (
              <li key={session.id}>
                <Tile
                  className="cursor-pointer hover:border-primary-400"
                  onClick={() => open(session.id)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-typography-900">
                        {session.title || strings.session.untitled}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-typography-500">
                        {strings.mode[session.mode] ?? session.mode}
                        {" · "}
                        {session.trackTitle || strings.list.noCourseYet}
                      </p>
                      <p className="mt-0.5 text-xs text-typography-500">
                        {strings.list.updatedLabel}: {formatUpdated(session.updatedAt)}
                      </p>
                    </div>
                    <CourseCopilotStatusTag status={session.status} />
                  </div>
                  <div className="mt-2 flex justify-end gap-1">
                    {ARCHIVABLE(session) && (
                      <Button
                        kind="ghost"
                        size="sm"
                        onClick={(event: React.MouseEvent) => {
                          // The card itself opens the session; this must not.
                          event.stopPropagation();
                          setArchiveTarget(session);
                        }}
                      >
                        {strings.list.archive}
                      </Button>
                    )}
                    <Button
                      kind="tertiary"
                      size="sm"
                      onClick={(event: React.MouseEvent) => {
                        event.stopPropagation();
                        open(session.id);
                      }}
                    >
                      {strings.list.open}
                    </Button>
                  </div>
                </Tile>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ActionConfirmationPopup
        isOpen={archiveTarget !== null}
        onClose={() => setArchiveTarget(null)}
        title={strings.list.archiveConfirmTitle}
        description={strings.list.archiveConfirmBody}
        primaryButton={{
          label: strings.list.archiveConfirm,
          onClick: () => void handleConfirmArchive(),
          variant: ButtonVariant.DESTRUCTIVE,
        }}
        secondaryButton={{
          label: strings.list.archiveCancel,
          onClick: () => setArchiveTarget(null),
          variant: ButtonVariant.SECONDARY,
        }}
      />
    </div>
  );
};
