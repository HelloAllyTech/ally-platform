import React, { useEffect, useState } from "react";

import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { Button, InlineNotification, SkeletonText, Tooltip } from "@ally-ui-mono/ui-shared";
import {
  useArchiveCourseCopilotSessionMutation,
  useCreateCourseCopilotSessionMutation,
  useGetCourseCopilotSessionsQuery,
} from "@api";
import { ActionConfirmationPopup } from "@components/action-confirmation-popup";
import { formatElapsed } from "@components/course-copilot/courseCopilotFormat";
import { ButtonVariant } from "@components/types";
import { en, LOCAL_STORAGE_KEYS, ROUTES } from "@constants";
import { CourseCopilotSessionSummary } from "@types";

import { errorMessageFrom } from "./courseCopilotErrors";
import { CourseCopilotStatusTag } from "./CourseCopilotStatusTag";

/** Archiving a session that is mid-build is left to the build's own cancel — see the session page. */
const ARCHIVABLE = (session: CourseCopilotSessionSummary) => session.status !== "BUILDING";

const toMs = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? null : ms;
};

/** "19 Nov, 3:30 pm" — a date a trainer can place without reading a full timestamp. */
const formatDate = (iso: string): string => {
  const ms = toMs(iso);
  return ms === null
    ? ""
    : new Date(ms).toLocaleString(undefined, {
        day: "numeric",
        month: "short",
        hour: "numeric",
        minute: "2-digit",
      });
};

/** "just now", "5 min ago", "3 h ago", then the date. */
const formatAgo = (iso: string, now: number): string => {
  const ms = toMs(iso);
  if (ms === null) return "";
  const minutes = Math.floor((now - ms) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return formatDate(iso);
};

const Stat: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="rounded-lg border border-neutral-200 bg-white px-4 py-3">
    <dt className="text-xs text-typography-600">{label}</dt>
    <dd className="mt-1 text-lg font-semibold text-typography-900">{value}</dd>
  </div>
);

/** The build line: live progress while it runs, the time it took once it has settled. */
const BuildLine: React.FC<{ session: CourseCopilotSessionSummary; now: number }> = ({
  session,
  now,
}) => {
  const list = en.courseCopilot.list;
  const build = session.build;
  if (!build || !build.startedAt) {
    return <span className="text-typography-500">{list.notBuilt}</span>;
  }
  const items = list.items(build.done, build.items);
  const failed = build.failed > 0 ? ` · ${list.failedItems(build.failed)}` : "";
  if (build.running) {
    const started = toMs(build.startedAt) ?? now;
    const percent = build.items ? Math.round((build.done / build.items) * 100) : 0;
    return (
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <span className="whitespace-nowrap font-medium text-primary-700">
          {list.buildingFor(formatElapsed(now - started))}
        </span>
        <span
          className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-neutral-200"
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={items}
        >
          <span className="block h-full bg-primary-500" style={{ width: `${percent}%` }} />
        </span>
        <span className="whitespace-nowrap text-typography-600">
          {items}
          {failed}
        </span>
      </span>
    );
  }
  return (
    <span>
      <span className="font-semibold text-typography-900">
        {build.seconds === null ? "—" : formatElapsed(build.seconds * 1000)}
      </span>
      <span className="text-typography-600">
        {" · "}
        {items}
        {failed}
      </span>
    </span>
  );
};

const SessionCard: React.FC<{
  session: CourseCopilotSessionSummary;
  now: number;
  onOpen: () => void;
  onArchive?: () => void;
}> = ({ session, now, onOpen, onArchive }) => {
  const strings = en.courseCopilot;
  const list = strings.list;
  const courseStatus = session.trackStatus
    ? (list.courseStatus[session.trackStatus] ?? session.trackStatus)
    : null;
  const live = session.trackStatus === "ACTIVE";
  const stateLine =
    live && session.status === "EDITING"
      ? list.stateLine.PUBLISHED
      : (list.stateLine[session.status] ?? "");

  return (
    <article
      className="cursor-pointer rounded-lg border border-neutral-200 bg-white p-4 transition-colors hover:border-primary-400 focus-within:border-primary-400"
      onClick={onOpen}
      data-testid="course-copilot-session-card"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-typography-900">
            {session.title || strings.session.untitled}
          </h2>
          <p className="mt-0.5 text-sm text-typography-700">{stateLine}</p>
        </div>
        <CourseCopilotStatusTag status={session.status} published={live} />
      </div>

      <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <div className="flex min-w-0 items-baseline gap-2 sm:col-span-2">
          <dt className="shrink-0 text-typography-500">
            <Tooltip label={list.buildTimeTooltip} align="top">
              <span className="cursor-help border-b border-dotted border-typography-400">
                {list.buildTime}
              </span>
            </Tooltip>
          </dt>
          <dd className="flex min-w-0 flex-1">
            <BuildLine session={session} now={now} />
          </dd>
        </div>
        <div className="flex items-baseline gap-2">
          <dt className="text-typography-500">{list.started}</dt>
          <dd className="text-typography-800">{formatDate(session.createdAt)}</dd>
        </div>
        <div className="flex items-baseline gap-2">
          <dt className="text-typography-500">{list.lastActivity}</dt>
          <dd className="text-typography-800">{formatAgo(session.updatedAt, now)}</dd>
        </div>
        <div className="flex min-w-0 items-baseline gap-2 sm:col-span-2">
          <dt className="shrink-0 text-typography-500">{list.course}</dt>
          <dd className="min-w-0 truncate text-typography-800">
            {session.trackTitle ? (
              <>
                {session.trackTitle}
                {courseStatus && <span className="text-typography-500"> · {courseStatus}</span>}
              </>
            ) : (
              <span className="text-typography-500">{list.noCourseYet}</span>
            )}
            {session.mode === "EDIT" && (
              <span className="text-typography-500"> · {strings.mode.EDIT}</span>
            )}
          </dd>
        </div>
      </dl>

      <div className="mt-3 flex items-center justify-end gap-2 border-t border-neutral-100 pt-3">
        {onArchive && (
          <Button
            kind="ghost"
            size="sm"
            onClick={(event: React.MouseEvent) => {
              // The card itself opens the session; this must not.
              event.stopPropagation();
              onArchive();
            }}
          >
            {list.archive}
          </Button>
        )}
        <Button
          kind="primary"
          size="sm"
          onClick={(event: React.MouseEvent) => {
            event.stopPropagation();
            onOpen();
          }}
        >
          {list.action[session.status] ?? list.open}
        </Button>
      </div>
    </article>
  );
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

  // A running build's "so far" time and "x min ago" move on their own; tick once a minute.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

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
  const list = strings.list;

  // At-a-glance numbers over the visible sessions. The average only counts builds that finished.
  const builtTimes = rows
    .map(session => session.build?.seconds)
    .filter((seconds): seconds is number => typeof seconds === "number");
  const isLive = (session: CourseCopilotSessionSummary) => session.trackStatus === "ACTIVE";
  const inProgress = rows.filter(session => session.status !== "EDITING").length;
  const published = rows.filter(session => session.status === "EDITING" && isLive(session)).length;
  const averageBuild = builtTimes.length
    ? builtTimes.reduce((sum, seconds) => sum + seconds, 0) / builtTimes.length
    : null;

  return (
    <div className="mx-auto w-full max-w-4xl p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-2xl">
          <h1 className="text-xl text-typography-900 md:text-2xl">{strings.title}</h1>
          <p className="mt-1 text-sm text-typography-600">{list.subtitle}</p>
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

      {rows.length > 0 && (
        <dl
          className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4"
          data-testid="course-copilot-stats"
        >
          <Stat label={list.stats.inProgress} value={String(inProgress)} />
          <Stat label={list.stats.built} value={String(rows.length - inProgress - published)} />
          <Stat label={list.stats.published} value={String(published)} />
          <Stat
            label={list.stats.averageBuild}
            value={averageBuild === null ? "—" : formatElapsed(averageBuild * 1000)}
          />
        </dl>
      )}

      <div className="mt-6">
        {isLoading ? (
          <SkeletonText paragraph lineCount={4} />
        ) : isError ? (
          <InlineNotification kind="error" lowContrast hideCloseButton title={list.loadFailed} />
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-neutral-300 p-6">
            <h2 className="text-base font-semibold text-typography-900">{list.emptyTitle}</h2>
            <p className="max-w-xl text-sm text-typography-600">{list.emptyBody}</p>
            <p className="max-w-xl text-sm text-typography-600">{list.empty}</p>
            <Button
              kind="primary"
              size="sm"
              disabled={isCreating}
              onClick={() => void handleNewCourse()}
            >
              {strings.newCourse}
            </Button>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {rows.map(session => (
              <li key={session.id}>
                <SessionCard
                  session={session}
                  now={now}
                  onOpen={() => open(session.id)}
                  onArchive={ARCHIVABLE(session) ? () => setArchiveTarget(session) : undefined}
                />
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
