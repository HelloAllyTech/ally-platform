import React, { useState } from "react";

import { useSelector } from "react-redux";
import { toast } from "sonner";

import {
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TextArea,
} from "@ally-ui-mono/ui-shared";
import { useGetAllyGuideDelegationQuery, useSetAllyGuideDelegationMutation } from "@api";
import { ConfirmDialog } from "@components/ally-guide/ConfirmDialog";
import { ErrorPanel, LoadingBlock } from "@components/ally-guide/ConsoleStates";
import { InfoTip } from "@components/ally-guide/InfoTip";
import { Pill, PillTone } from "@components/ally-guide/Pill";
import { en } from "@constants";
import { useAllyGuideAccess } from "@hooks";
import { RootState } from "@store";
import { AllyGuideDelegationStage, AllyGuidePrecondition } from "@types";
import { formatDateTime, getErrorMessage } from "@utils";

const STAGES: AllyGuideDelegationStage[] = [1, 2, 3];

/** κ is a figure under 1; every other requirement is a count. */
const figure = (precondition: AllyGuidePrecondition, value: number | null): string => {
  if (value === null) return en.allyConsole.delegation.nothingYet;
  return precondition.id.startsWith("kappa:") ? value.toFixed(2) : String(value);
};

/**
 * The progressive-delegation stage (plan §7.13, Appendix A): how much of the release pipeline runs
 * without a person, and every precondition with its actual figure beside what it needs.
 *
 * Raising goes one step at a time and only to a stage whose requirements all hold; lowering is
 * allowed whenever. The buttons say what they will do and why one is unavailable, and each change
 * asks for a reason that is kept in the learning audit. Reading is for anyone with the Console;
 * changing the stage needs the edit grant and is hidden without it.
 */
export const DelegationPanel: React.FC = () => {
  const strings = en.allyConsole.delegation;
  const { canEdit } = useAllyGuideAccess();
  const currentUserId = useSelector((state: RootState) => state.user?.user?.id);
  const { data, isLoading, isError, error, refetch } = useGetAllyGuideDelegationQuery();
  const [setStage, { isLoading: isSaving }] = useSetAllyGuideDelegationMutation();

  const [target, setTarget] = useState<AllyGuideDelegationStage | null>(null);
  const [reason, setReason] = useState("");

  if (isLoading) return <LoadingBlock lines={4} />;
  if (isError || !data) {
    return <ErrorPanel what={strings.loadFailed} error={error} onRetry={() => void refetch()} />;
  }

  const raising = target !== null && target > data.stage;
  const close = () => {
    setTarget(null);
    setReason("");
  };
  const handleConfirm = async () => {
    if (target === null) return;
    try {
      await setStage({ stage: target, reason }).unwrap();
      toast.success(strings.dialog.success(target));
      close();
    } catch (failure) {
      toast.error(getErrorMessage(failure, strings.dialog.failed));
    }
  };

  const who =
    data.changedBy === null
      ? null
      : currentUserId !== undefined &&
          currentUserId !== null &&
          Number(currentUserId) === data.changedBy
        ? strings.you
        : (data.changedByName ?? strings.user(data.changedBy));
  const changedAt = data.changedAt ? formatDateTime(data.changedAt) : "";
  const next = (data.stage + 1) as AllyGuideDelegationStage;
  const canRaise = data.stage < 3 && next <= data.unlocked;
  const lowerStages = STAGES.filter(stage => stage < data.stage);

  const tone = (stage: AllyGuideDelegationStage): PillTone =>
    stage === data.stage ? "success" : stage <= data.unlocked ? "info" : "neutral";
  const word = (stage: AllyGuideDelegationStage) =>
    stage === data.stage
      ? strings.stageWords.current
      : stage <= data.unlocked
        ? strings.stageWords.unlocked
        : strings.stageWords.locked;

  return (
    <section
      className="flex flex-col gap-4 border border-border-light p-4"
      aria-labelledby="delegation-heading"
      data-testid="ally-delegation"
    >
      <div className="flex items-center gap-1">
        <h3 id="delegation-heading" className="text-xl font-normal text-typography-900">
          {strings.heading}
        </h3>
        <InfoTip label={strings.help} ariaLabel="About delegation" />
      </div>

      <div className="flex flex-col gap-1">
        <p className="text-base font-semibold text-typography-900" data-testid="delegation-stage">
          {strings.stageLine(data.stage, data.label)}
        </p>
        <p className="text-sm text-typography-700">{strings.unlockedUpTo(data.unlocked)}</p>
        {data.autoRevert && (
          <p className="text-sm text-typography-700" data-testid="delegation-auto-revert">
            {strings.autoRevert}
          </p>
        )}
        {data.changedAt && (
          <p className="text-sm text-typography-700" data-testid="delegation-changed">
            {who === null ? strings.changedBySystem(changedAt) : strings.changed(who, changedAt)}
            {data.reason ? ` ${strings.reason(data.reason)}` : ""}
          </p>
        )}
      </div>

      <ol className="grid grid-cols-1 gap-2 md:grid-cols-3" data-testid="delegation-stages">
        {data.stages.map(item => (
          <li key={item.stage} className="flex flex-col gap-1 border border-border-light p-3">
            <span className="flex items-center gap-2">
              <span className="text-sm font-semibold text-typography-900">
                {strings.neededFor(item.stage)}
              </span>
              <Pill tone={tone(item.stage)}>{word(item.stage)}</Pill>
            </span>
            <span className="text-sm text-typography-800">{item.label}</span>
          </li>
        ))}
      </ol>

      {canEdit && (
        <div className="flex flex-col gap-2" data-testid="delegation-actions">
          <div className="flex flex-wrap gap-2">
            {data.stage < 3 && (
              <Button kind="primary" size="md" disabled={!canRaise} onClick={() => setTarget(next)}>
                {strings.raise(next)}
              </Button>
            )}
            {lowerStages.map(stage => (
              <Button
                key={stage}
                kind="danger--tertiary"
                size="md"
                onClick={() => setTarget(stage)}
              >
                {strings.lower(stage)}
              </Button>
            ))}
          </div>
          {data.stage < 3 && !canRaise && (
            <p className="text-sm text-typography-700" data-testid="delegation-locked">
              {strings.raiseLocked(next)}
            </p>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-1">
          <h4 className="text-lg font-normal text-typography-900">
            {strings.preconditionsHeading}
          </h4>
          <InfoTip label={strings.preconditionsHelp} ariaLabel="About the requirements" />
        </div>
        <div className="overflow-x-auto">
          <Table
            className="w-full border-collapse text-left"
            data-testid="delegation-preconditions"
          >
            <TableHead>
              <TableRow className="border-b border-border-light text-sm text-typography-700">
                <TableHeader className="py-2 pr-4 font-medium">
                  {strings.columns.requirement}
                </TableHeader>
                <TableHeader className="py-2 pr-4 font-medium">{strings.columns.stage}</TableHeader>
                <TableHeader className="py-2 pr-4 font-medium">{strings.columns.need}</TableHeader>
                <TableHeader className="py-2 pr-4 font-medium">{strings.columns.have}</TableHeader>
                <TableHeader className="py-2 pr-4 font-medium">{strings.columns.met}</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.preconditions.map(precondition => (
                <TableRow
                  key={precondition.id}
                  className="border-b border-border-light text-sm text-typography-900"
                  data-testid={`precondition-${precondition.id}`}
                >
                  <TableCell className="py-2 pr-4">{precondition.label}</TableCell>
                  <TableCell className="whitespace-nowrap py-2 pr-4">
                    {strings.neededFor(precondition.stage)}
                  </TableCell>
                  <TableCell className="py-2 pr-4 tabular-nums">
                    {figure(precondition, precondition.need)}
                  </TableCell>
                  <TableCell className="py-2 pr-4 tabular-nums">
                    {figure(precondition, precondition.have)}
                  </TableCell>
                  <TableCell className="py-2 pr-4">
                    <Pill tone={precondition.met ? "success" : "neutral"}>
                      {precondition.met ? strings.met : strings.notMet}
                    </Pill>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      <ConfirmDialog
        isOpen={target !== null}
        title={
          target === null
            ? ""
            : raising
              ? strings.dialog.raiseTitle(target)
              : strings.dialog.lowerTitle(target)
        }
        cancelLabel={strings.dialog.cancel}
        confirmLabel={
          isSaving
            ? strings.dialog.working
            : target === null
              ? ""
              : raising
                ? strings.dialog.confirmRaise(target)
                : strings.dialog.confirmLower(target)
        }
        danger={!raising}
        isWorking={isSaving}
        onConfirm={() => void handleConfirm()}
        onClose={close}
      >
        <p>
          {raising && target !== null
            ? (strings.dialog.raiseBody[target] ?? "")
            : strings.dialog.lowerBody}
        </p>
        <TextArea
          id="delegation-reason"
          labelText={strings.dialog.reasonLabel}
          helperText={strings.dialog.reasonHint}
          placeholder={strings.dialog.reasonPlaceholder}
          rows={3}
          maxCount={2000}
          enableCounter
          value={reason}
          onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) =>
            setReason(event.target.value)
          }
        />
      </ConfirmDialog>
    </section>
  );
};
