import React, { useState } from "react";

import { useSelector } from "react-redux";
import { toast } from "sonner";

import {
  Button,
  Select,
  SelectItem,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TextArea,
} from "@ally-ui-mono/ui-shared";
import {
  useApproveAllyGuideLessonMutation,
  useGetAllyGuideLearningAuditQuery,
  useGetAllyGuideLessonsQuery,
  useGetAllyGuidePlaybookQuery,
  useRejectAllyGuideLessonMutation,
  useRetireAllyGuideLessonMutation,
  useRunAllyGuideCuratorMutation,
} from "@api";
import { ConfirmDialog } from "@components/ally-guide/ConfirmDialog";
import { EmptyPanel, ErrorPanel, LoadingBlock } from "@components/ally-guide/ConsoleStates";
import { InfoTip } from "@components/ally-guide/InfoTip";
import { Pill, PillTone } from "@components/ally-guide/Pill";
import { en } from "@constants";
import { useAllyGuideAccess } from "@hooks";
import { RootState } from "@store";
import {
  AllyGuideLearningAuditRow,
  AllyGuideLesson,
  AllyGuideLessonScope,
  AllyGuideLessonStatus,
} from "@types";
import { formatDateTime, getErrorMessage } from "@utils";

import { summariseDetail } from "./loopFormat";

const STATUS_FILTERS = [
  "quarantined",
  "proposed",
  "approved",
  "active",
  "blocked",
  "rejected",
  "retired",
  "all",
] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];
const SCOPES: AllyGuideLessonScope[] = ["platform", "org", "course"];
const LESSON_LIMIT = 200;
const AUDIT_LIMIT = 100;

const STATUS_TONES: Record<string, PillTone> = {
  quarantined: "warning",
  blocked: "danger",
  rejected: "neutral",
  retired: "neutral",
  active: "success",
  approved: "info",
  proposed: "info",
};

type Decision = "approve" | "reject" | "retire";

const isLessonId = (id: string) => !id.startsWith("snapshot-");

/**
 * The curator and what it proposes. The curator reads trusted evidence, proposes a few lessons or
 * tweaks and passes them through guardrails; a change it is unsure of is quarantined for a person,
 * and that is the first thing shown. Below, the playbook the live release carries (with each
 * scope's cap) and the learning audit. Everything here is the curator's own text and counts, never a
 * learner's words. Running it and every decision need the edit grant and are hidden without it.
 */
export const CuratorPanel: React.FC = () => {
  const strings = en.allyConsole.curator;
  const { canEdit } = useAllyGuideAccess();
  const currentUserId = useSelector((state: RootState) => state.user?.user?.id);
  const [status, setStatus] = useState<StatusFilter>("quarantined");
  const [scope, setScope] = useState<"" | AllyGuideLessonScope>("");

  const lessons = useGetAllyGuideLessonsQuery({
    status: status === "all" ? undefined : (status as AllyGuideLessonStatus),
    scope: scope || undefined,
    limit: LESSON_LIMIT,
  });
  const playbook = useGetAllyGuidePlaybookQuery();
  const audit = useGetAllyGuideLearningAuditQuery({ limit: AUDIT_LIMIT });
  const [runCurator, { isLoading: isStarting }] = useRunAllyGuideCuratorMutation();
  const [approve] = useApproveAllyGuideLessonMutation();
  const [reject] = useRejectAllyGuideLessonMutation();
  const [retire] = useRetireAllyGuideLessonMutation();

  const [runOpen, setRunOpen] = useState(false);
  const [deciding, setDeciding] = useState<{
    lesson: { id: string; text: string };
    decision: Decision;
  } | null>(null);
  const [notes, setNotes] = useState("");
  const [isDeciding, setIsDeciding] = useState(false);

  const closeDecision = () => {
    setDeciding(null);
    setNotes("");
  };

  const handleRun = async () => {
    try {
      await runCurator().unwrap();
      toast.success(strings.runDialog.started);
      setRunOpen(false);
    } catch (failure) {
      toast.error(getErrorMessage(failure, strings.runDialog.failed));
    }
  };

  const handleDecision = async () => {
    if (!deciding) return;
    const { lesson, decision } = deciding;
    const call = decision === "approve" ? approve : decision === "reject" ? reject : retire;
    setIsDeciding(true);
    try {
      await call({ id: lesson.id, notes }).unwrap();
      toast.success(
        strings.decisionDialog[
          decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "retired"
        ],
      );
      closeDecision();
    } catch (failure) {
      toast.error(getErrorMessage(failure, strings.decisionDialog.failed));
    } finally {
      setIsDeciding(false);
    }
  };

  const who = (id: number | null, kind: string, name: string | null): string =>
    id === null || id === undefined
      ? (strings.actors[kind] ?? kind)
      : currentUserId !== undefined && currentUserId !== null && Number(currentUserId) === id
        ? en.allyConsole.delegation.you
        : (name ?? en.allyConsole.delegation.user(id));

  const decisionCopy = deciding
    ? deciding.decision === "approve"
      ? [
          strings.decisionDialog.approveTitle,
          strings.decisionDialog.approveBody,
          strings.decisionDialog.confirmApprove,
        ]
      : deciding.decision === "reject"
        ? [
            strings.decisionDialog.rejectTitle,
            strings.decisionDialog.rejectBody,
            strings.decisionDialog.confirmReject,
          ]
        : [
            strings.decisionDialog.retireTitle,
            strings.decisionDialog.retireBody,
            strings.decisionDialog.confirmRetire,
          ]
    : ["", "", ""];

  const actionsFor = (lesson: AllyGuideLesson) => {
    const buttons: {
      decision: Decision;
      label: string;
      aria: string;
      kind: "primary" | "danger--tertiary" | "tertiary";
    }[] = [];
    if (lesson.status === "quarantined") {
      buttons.push({
        decision: "approve",
        label: strings.approve,
        aria: strings.approveLabel(lesson.text),
        kind: "primary",
      });
    }
    if (["quarantined", "approved", "proposed"].includes(lesson.status)) {
      buttons.push({
        decision: "reject",
        label: strings.reject,
        aria: strings.rejectLabel(lesson.text),
        kind: "danger--tertiary",
      });
    }
    if (lesson.status === "active") {
      buttons.push({
        decision: "retire",
        label: strings.retire,
        aria: strings.retireLabel(lesson.text),
        kind: "danger--tertiary",
      });
    }
    return buttons;
  };

  const capLines = (): string[] => {
    const caps = playbook.data?.caps;
    if (!caps) return [];
    const fullest = (used: Record<string, number>) => Math.max(0, ...Object.values(used));
    return [
      strings.capPlatform(caps.platform.used, caps.platform.max),
      strings.capScoped(strings.scopes.org, fullest(caps.org.used), caps.org.max),
      strings.capScoped(strings.scopes.course, fullest(caps.course.used), caps.course.max),
    ];
  };

  return (
    <div className="flex flex-col gap-10" data-testid="ally-curator">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-3xl text-sm text-typography-700">{strings.intro}</p>
        {canEdit && (
          <Button kind="tertiary" size="md" onClick={() => setRunOpen(true)}>
            {strings.run}
          </Button>
        )}
      </div>

      <section className="flex flex-col gap-3" aria-labelledby="curator-lessons-heading">
        <div className="flex items-center gap-1">
          <h3 id="curator-lessons-heading" className="text-xl font-normal text-typography-900">
            {strings.lessonsHeading}
          </h3>
          <InfoTip label={strings.lessonsHelp} ariaLabel="About proposed changes" />
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <Select
            id="curator-status"
            labelText={strings.statusLabel}
            value={status}
            onChange={(event: React.ChangeEvent<HTMLSelectElement>) =>
              setStatus(event.target.value as StatusFilter)
            }
          >
            {STATUS_FILTERS.map(name => (
              <SelectItem key={name} value={name} text={strings.statuses[name]} />
            ))}
          </Select>
          <Select
            id="curator-scope"
            labelText={strings.scopeFilter}
            value={scope}
            onChange={(event: React.ChangeEvent<HTMLSelectElement>) =>
              setScope(event.target.value as "" | AllyGuideLessonScope)
            }
          >
            <SelectItem value="" text={strings.allScopes} />
            {SCOPES.map(name => (
              <SelectItem key={name} value={name} text={strings.scopes[name]} />
            ))}
          </Select>
        </div>

        {lessons.isError ? (
          <ErrorPanel
            what={strings.loadFailed}
            error={lessons.error}
            onRetry={() => void lessons.refetch()}
          />
        ) : !lessons.currentData ? (
          <LoadingBlock lines={4} />
        ) : lessons.currentData.length === 0 ? (
          <EmptyPanel title={strings.emptyTitles[status]} message={strings.emptyMessage} />
        ) : (
          <div className="overflow-x-auto">
            <Table className="w-full border-collapse text-left" data-testid="curator-lessons">
              <TableHead>
                <TableRow className="border-b border-border-light text-sm text-typography-700">
                  <TableHeader className="py-3 pr-4 font-medium">
                    {strings.columns.change}
                  </TableHeader>
                  <TableHeader className="py-3 pr-4 font-medium">
                    {strings.columns.scope}
                  </TableHeader>
                  <TableHeader className="py-3 pr-4 font-medium">
                    {strings.columns.status}
                  </TableHeader>
                  <TableHeader className="py-3 pr-4 font-medium">
                    {strings.columns.when}
                  </TableHeader>
                  <TableHeader className="py-3 pr-4 font-medium">
                    <span className="sr-only">Actions</span>
                  </TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {lessons.currentData.map(lesson => (
                  <TableRow
                    key={lesson.id}
                    className="border-b border-border-light align-top text-sm text-typography-900"
                    data-testid="curator-lesson-row"
                  >
                    <TableCell className="max-w-lg py-3 pr-4">
                      <span className="block text-xs text-typography-700">
                        {strings.kinds[lesson.kind] ?? lesson.kind}
                      </span>
                      <span
                        className="block whitespace-pre-wrap break-words"
                        data-testid="lesson-text"
                      >
                        {lesson.text}
                      </span>
                      {lesson.rationale && (
                        <span className="mt-1 block text-xs text-typography-700">
                          {strings.rationale(lesson.rationale)}
                        </span>
                      )}
                      {lesson.blockReason && (
                        <span className="mt-1 block text-xs text-destructive-600">
                          {strings.blockedBy(lesson.blockReason)}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="py-3 pr-4">
                      {strings.scopes[lesson.scope] ?? lesson.scope}
                    </TableCell>
                    <TableCell className="py-3 pr-4">
                      <Pill tone={STATUS_TONES[lesson.status] ?? "neutral"}>
                        {strings.statuses[lesson.status] ?? lesson.status}
                      </Pill>
                      {lesson.decidedAt && (
                        <span className="mt-1 block text-xs text-typography-700">
                          {strings.decided(
                            who(lesson.decidedBy, "human", lesson.decidedByName),
                            formatDateTime(lesson.decidedAt),
                          )}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap py-3 pr-4">
                      {formatDateTime(lesson.createdAt)}
                    </TableCell>
                    <TableCell className="py-3 pr-4">
                      {canEdit && (
                        <div className="flex flex-wrap gap-2">
                          {actionsFor(lesson).map(action => (
                            <Button
                              key={action.decision}
                              kind={action.kind}
                              size="sm"
                              aria-label={action.aria}
                              onClick={() => setDeciding({ lesson, decision: action.decision })}
                            >
                              {action.label}
                            </Button>
                          ))}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {lessons.currentData && lessons.currentData.length >= LESSON_LIMIT && (
          <p className="text-xs text-typography-700">{strings.limitNote(LESSON_LIMIT)}</p>
        )}
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="curator-playbook-heading">
        <div className="flex items-center gap-1">
          <h3 id="curator-playbook-heading" className="text-xl font-normal text-typography-900">
            {strings.playbookHeading}
          </h3>
          <InfoTip label={strings.playbookHelp} ariaLabel="About the playbook" />
        </div>
        {playbook.isLoading ? (
          <LoadingBlock lines={3} />
        ) : playbook.isError || !playbook.data ? (
          <ErrorPanel
            what={strings.loadPlaybookFailed}
            error={playbook.error}
            onRetry={() => void playbook.refetch()}
          />
        ) : (
          <>
            <p className="text-sm text-typography-800" data-testid="playbook-release">
              {strings.playbookRelease(playbook.data.version)}
            </p>
            {capLines().length > 0 && (
              <ul
                className="flex flex-wrap gap-4 text-sm text-typography-800"
                data-testid="playbook-caps"
              >
                {capLines().map(line => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
            {playbook.data.lessons.length === 0 ? (
              <p className="text-sm text-typography-700" data-testid="playbook-empty">
                {strings.playbookEmpty}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table className="w-full border-collapse text-left" data-testid="playbook-table">
                  <TableHead>
                    <TableRow className="border-b border-border-light text-sm text-typography-700">
                      <TableHeader className="py-2 pr-4 font-medium">
                        {strings.playbookColumns.lesson}
                      </TableHeader>
                      <TableHeader className="py-2 pr-4 font-medium">
                        {strings.playbookColumns.scope}
                      </TableHeader>
                      <TableHeader className="py-2 pr-4 font-medium">
                        <span className="sr-only">Actions</span>
                      </TableHeader>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {playbook.data.lessons.map(lesson => (
                      <TableRow
                        key={lesson.id}
                        className="border-b border-border-light align-top text-sm text-typography-900"
                        data-testid="playbook-row"
                      >
                        <TableCell className="max-w-lg whitespace-pre-wrap break-words py-2 pr-4">
                          {lesson.text}
                        </TableCell>
                        <TableCell className="py-2 pr-4">
                          {strings.scopes[lesson.scope] ?? lesson.scope}
                        </TableCell>
                        <TableCell className="py-2 pr-4">
                          {canEdit && isLessonId(lesson.id) && (
                            <Button
                              kind="danger--tertiary"
                              size="sm"
                              aria-label={strings.retireLabel(lesson.text)}
                              onClick={() =>
                                setDeciding({
                                  lesson: { id: lesson.id, text: lesson.text },
                                  decision: "retire",
                                })
                              }
                            >
                              {strings.retire}
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </>
        )}
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="curator-audit-heading">
        <div className="flex items-center gap-1">
          <h3 id="curator-audit-heading" className="text-xl font-normal text-typography-900">
            {strings.auditHeading}
          </h3>
          <InfoTip label={strings.auditHelp} ariaLabel="About the learning audit" />
        </div>
        {audit.isLoading ? (
          <LoadingBlock lines={3} />
        ) : audit.isError || !audit.data ? (
          <ErrorPanel
            what={strings.auditLoadFailed}
            error={audit.error}
            onRetry={() => void audit.refetch()}
          />
        ) : audit.data.length === 0 ? (
          <p className="text-sm text-typography-700" data-testid="audit-empty">
            {strings.auditEmpty}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table className="w-full border-collapse text-left" data-testid="learning-audit">
              <TableHead>
                <TableRow className="border-b border-border-light text-sm text-typography-700">
                  <TableHeader className="py-2 pr-4 font-medium">
                    {strings.auditColumns.when}
                  </TableHeader>
                  <TableHeader className="py-2 pr-4 font-medium">
                    {strings.auditColumns.what}
                  </TableHeader>
                  <TableHeader className="py-2 pr-4 font-medium">
                    {strings.auditColumns.who}
                  </TableHeader>
                  <TableHeader className="py-2 pr-4 font-medium">
                    {strings.auditColumns.detail}
                  </TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {audit.data.map((row: AllyGuideLearningAuditRow) => (
                  <TableRow
                    key={row.id}
                    className="border-b border-border-light align-top text-sm text-typography-900"
                    data-testid="learning-audit-row"
                  >
                    <TableCell className="whitespace-nowrap py-2 pr-4">
                      {formatDateTime(row.createdAt)}
                    </TableCell>
                    <TableCell className="py-2 pr-4">
                      {strings.auditActions[row.action] ?? row.action}
                    </TableCell>
                    <TableCell className="py-2 pr-4">
                      {who(row.actorUserId, row.actorKind, row.actorName)}
                    </TableCell>
                    <TableCell className="max-w-md break-words py-2 pr-4 text-xs text-typography-700">
                      {summariseDetail(row.detail)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <ConfirmDialog
        isOpen={runOpen}
        title={strings.runDialog.title}
        cancelLabel={strings.runDialog.cancel}
        confirmLabel={isStarting ? strings.runDialog.working : strings.runDialog.confirm}
        isWorking={isStarting}
        onConfirm={() => void handleRun()}
        onClose={() => setRunOpen(false)}
      >
        <p>{strings.runDialog.body}</p>
      </ConfirmDialog>

      <ConfirmDialog
        isOpen={deciding !== null}
        title={decisionCopy[0]}
        cancelLabel={strings.decisionDialog.cancel}
        confirmLabel={isDeciding ? strings.decisionDialog.working : decisionCopy[2]}
        danger={deciding?.decision !== "approve"}
        isWorking={isDeciding}
        onConfirm={() => void handleDecision()}
        onClose={closeDecision}
      >
        <p className="whitespace-pre-wrap break-words font-medium">{deciding?.lesson.text}</p>
        <p>{decisionCopy[1]}</p>
        <TextArea
          id="curator-decision-notes"
          labelText={strings.decisionDialog.notesLabel}
          helperText={strings.decisionDialog.notesHint}
          rows={3}
          maxCount={2000}
          enableCounter
          value={notes}
          onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setNotes(event.target.value)}
        />
      </ConfirmDialog>
    </div>
  );
};
