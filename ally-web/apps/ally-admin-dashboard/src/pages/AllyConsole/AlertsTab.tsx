import React, { useState } from "react";

import { useSelector } from "react-redux";
import { toast } from "sonner";

import {
  Button,
  ContentSwitcher,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@ally-ui-mono/ui-shared";
import {
  useAcknowledgeAllyGuideAlertMutation,
  useCheckAllyGuideAlertsMutation,
  useGetAllyGuideAlertCountsQuery,
  useGetAllyGuideAlertsQuery,
} from "@api";
import { ALERTS_PAGE_LIMIT } from "@components/ally-guide/allyGuideFormat";
import { EmptyPanel, ErrorPanel, LoadingBlock } from "@components/ally-guide/ConsoleStates";
import { InfoTip } from "@components/ally-guide/InfoTip";
import { Pill } from "@components/ally-guide/Pill";
import { en } from "@constants";
import { useAllyGuideAccess } from "@hooks";
import { RootState } from "@store";
import { AllyGuideAlert } from "@types";
import { formatDateTime, getErrorMessage } from "@utils";

/** Where an alert went. Older alerts carry only `notifiedAt`, so that decides when `delivery` is absent. */
const DeliveryCell: React.FC<{ alert: AllyGuideAlert }> = ({ alert }) => {
  const strings = en.allyConsole.alerts;
  const delivery = alert.delivery ?? (alert.notifiedAt ? "posted" : null);
  if (delivery === "posted") {
    return (
      <>
        {alert.notifiedAt ? strings.posted(formatDateTime(alert.notifiedAt)) : strings.posted("")}
      </>
    );
  }
  const [label, help] =
    delivery === "no_channel"
      ? [strings.noChannel, strings.noChannelHelp]
      : delivery === "failed"
        ? [strings.postFailed, strings.postFailedHelp]
        : [strings.notPosted, strings.notPostedHelp];
  return (
    <span className="inline-flex items-center gap-1 text-typography-700">
      {label}
      <InfoTip label={help} ariaLabel={`About ${label}`} />
    </span>
  );
};

type AlertFilter = "open" | "all";
const FILTERS: AlertFilter[] = ["open", "all"];

/**
 * The alerts the health rules have raised, newest first, and the one thing a person does with them:
 * acknowledge, so the team can tell what has been looked at.
 *
 * Reading is for everyone with the console; acknowledging and "Check now" change shared state (and
 * "Check now" posts to the team channel) so they need the edit grant and are hidden without it. An
 * alert carries numbers only, never a learner, an organisation or a message.
 */
export const AlertsTab: React.FC = () => {
  const strings = en.allyConsole.alerts;
  const { canEdit } = useAllyGuideAccess();
  const currentUserId = useSelector((state: RootState) => state.user?.user?.id);
  const [filter, setFilter] = useState<AlertFilter>("open");
  // `currentData`, not `data`: switching the filter must not show the other list under its label.
  // "Open" asks the server for unacknowledged alerts only, so an old open one is never missed.
  const {
    currentData: data,
    isError,
    error,
    refetch,
    isFetching,
  } = useGetAllyGuideAlertsQuery({ limit: ALERTS_PAGE_LIMIT, open: filter === "open" });
  const { data: counts } = useGetAllyGuideAlertCountsQuery();
  const [checkNow, { isLoading: checking }] = useCheckAllyGuideAlertsMutation();
  const [acknowledge] = useAcknowledgeAllyGuideAlertMutation();

  const [acknowledgingId, setAcknowledgingId] = useState<string | null>(null);

  const handleCheck = async () => {
    try {
      const fired = await checkNow().unwrap();
      toast.success(strings.checked(Array.isArray(fired) ? fired.length : 0));
    } catch (failure) {
      toast.error(getErrorMessage(failure, strings.checkFailed));
    }
  };

  const handleAcknowledge = async (alert: AllyGuideAlert) => {
    setAcknowledgingId(alert.id);
    try {
      await acknowledge(alert.id).unwrap();
      toast.success(strings.acknowledged);
    } catch (failure) {
      toast.error(getErrorMessage(failure, strings.acknowledgeFailed));
    } finally {
      setAcknowledgingId(null);
    }
  };

  const header = (
    <>
      <p className="max-w-3xl text-sm text-typography-700">{strings.intro}</p>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ContentSwitcher
          size="md"
          selectedIndex={FILTERS.indexOf(filter)}
          onChange={(event: { name?: string | number }) => setFilter(event.name as AlertFilter)}
          className="max-w-xs"
          aria-label={strings.filterLabel}
        >
          <Switch name="open" text={strings.openFilter(counts?.open ?? 0)} />
          <Switch name="all" text={strings.allFilter} />
        </ContentSwitcher>
        <div className="flex flex-wrap items-center gap-2">
          <Button kind="ghost" size="md" disabled={isFetching} onClick={() => void refetch()}>
            {strings.refresh}
          </Button>
          {canEdit && (
            <span className="inline-flex items-center gap-1">
              <Button
                kind="tertiary"
                size="md"
                disabled={checking}
                onClick={() => void handleCheck()}
              >
                {checking ? strings.checking : strings.checkNow}
              </Button>
              <InfoTip label={strings.checkHelp} ariaLabel="About checking now" />
            </span>
          )}
        </div>
      </div>
    </>
  );

  if (isError) {
    return <ErrorPanel what="the alerts" error={error} onRetry={() => void refetch()} />;
  }
  if (!data) {
    return (
      <div className="flex flex-col gap-4" data-testid="ally-alerts">
        {header}
        <LoadingBlock lines={6} />
      </div>
    );
  }

  const shown = data;

  const acknowledgedBy = (alert: AllyGuideAlert): string => {
    const at = alert.acknowledgedAt ? formatDateTime(alert.acknowledgedAt) : "";
    if (alert.acknowledgedBy === null || alert.acknowledgedBy === undefined) {
      return strings.acknowledgedUnknown(at);
    }
    const who =
      currentUserId !== null &&
      currentUserId !== undefined &&
      Number(currentUserId) === alert.acknowledgedBy
        ? strings.you
        : alert.acknowledgedByName?.trim() || strings.user(alert.acknowledgedBy);
    return strings.acknowledgedBy(who, at);
  };

  return (
    <div className="flex flex-col gap-4" data-testid="ally-alerts">
      {header}

      {shown.length === 0 ? (
        filter === "open" && (counts?.total ?? 0) > 0 ? (
          <EmptyPanel
            title={strings.noneOpenTitle}
            message={strings.noneOpenMessage(
              Math.max(0, (counts?.total ?? 0) - (counts?.open ?? 0)),
            )}
          />
        ) : (
          <EmptyPanel title={strings.emptyTitle} message={strings.emptyMessage} />
        )
      ) : (
        <div className="overflow-x-auto">
          <Table className="w-full border-collapse text-left" data-testid="ally-alerts-table">
            <TableHead>
              <TableRow className="border-b border-border-light text-sm text-typography-700">
                <TableHeader className="py-3 pr-4 font-medium">{strings.columns.when}</TableHeader>
                <TableHeader className="py-3 pr-4 font-medium">
                  {strings.columns.severity}
                </TableHeader>
                <TableHeader className="py-3 pr-4 font-medium">{strings.columns.rule}</TableHeader>
                <TableHeader className="py-3 pr-4 font-medium">{strings.columns.what}</TableHeader>
                <TableHeader className="py-3 pr-4 font-medium">
                  {strings.columns.status}
                </TableHeader>
                <TableHeader className="py-3 pr-4 font-medium">
                  {strings.columns.channel}
                </TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {shown.map(alert => {
                const rule = strings.rules[alert.rule];
                const isOpen = alert.acknowledgedAt === null;
                return (
                  <TableRow
                    key={alert.id}
                    className="border-b border-border-light align-top text-sm text-typography-900"
                    data-testid="alert-row"
                  >
                    <TableCell className="whitespace-nowrap py-3 pr-4">
                      {formatDateTime(alert.createdAt)}
                    </TableCell>
                    <TableCell className="py-3 pr-4">
                      <Pill tone={alert.severity === "critical" ? "danger" : "warning"}>
                        {strings.severities[alert.severity] ?? alert.severity}
                      </Pill>
                    </TableCell>
                    <TableCell className="py-3 pr-4">
                      <span className="inline-flex items-center gap-1">
                        {rule?.label ?? alert.rule}
                        {rule && <InfoTip label={rule.help} ariaLabel={`About ${rule.label}`} />}
                      </span>
                    </TableCell>
                    <TableCell className="max-w-md break-words py-3 pr-4">
                      {alert.summary}
                    </TableCell>
                    <TableCell className="py-3 pr-4">
                      {isOpen ? (
                        <div className="flex flex-col items-start gap-2">
                          <Pill tone="info">{strings.open}</Pill>
                          {canEdit && (
                            <Button
                              kind="tertiary"
                              size="sm"
                              aria-label={strings.acknowledgeLabel(alert.summary)}
                              disabled={acknowledgingId === alert.id}
                              onClick={() => void handleAcknowledge(alert)}
                            >
                              {acknowledgingId === alert.id
                                ? strings.acknowledging
                                : strings.acknowledge}
                            </Button>
                          )}
                        </div>
                      ) : (
                        <span className="text-typography-700">{acknowledgedBy(alert)}</span>
                      )}
                    </TableCell>
                    <TableCell className="py-3 pr-4">
                      <DeliveryCell alert={alert} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {data.length >= ALERTS_PAGE_LIMIT && (
        <p className="text-xs text-typography-700" data-testid="alerts-limit-note">
          {strings.limitNote(ALERTS_PAGE_LIMIT)}
        </p>
      )}
    </div>
  );
};
