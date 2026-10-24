import React, { useMemo } from "react";

import {
  Button,
  SidePanel,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@ally-ui-mono/ui-shared";
import { useGetAllyGuideReleaseQuery } from "@api";
import {
  flattenToRows,
  KeyValueRow,
  releaseVersionLabel,
  shortId,
} from "@components/ally-guide/allyGuideFormat";
import { ErrorPanel, LoadingBlock } from "@components/ally-guide/ConsoleStates";
import { InfoTip } from "@components/ally-guide/InfoTip";
import { en } from "@constants";
import { AllyGuidePromptRef, AllyGuideRelease } from "@types";
import { formatDateTime } from "@utils";

import { canStartCanary } from "./canaryShare";
import { ReleaseStatusPill } from "./ReleaseStatusPill";

const PRE_CLASSES =
  "max-h-80 overflow-auto whitespace-pre-wrap break-words bg-background-secondary p-3 font-mono text-xs text-typography-900";

const KeyValueTable: React.FC<{ rows: KeyValueRow[]; testId: string }> = ({ rows, testId }) => {
  const strings = en.allyConsole.releases.detail;
  return (
    <Table className="w-full border-collapse text-left" data-testid={testId}>
      <TableHead>
        <TableRow className="border-b border-border-light text-xs text-typography-700">
          <TableHeader className="py-2 pr-4 font-medium">{strings.key}</TableHeader>
          <TableHeader className="py-2 font-medium">{strings.value}</TableHeader>
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.map(row => (
          <TableRow
            key={row.key}
            className="border-b border-border-light text-sm text-typography-900"
          >
            <TableCell className="py-2 pr-4 font-mono text-xs">{row.key}</TableCell>
            <TableCell className="py-2 break-words tabular-nums">{row.value}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
};

const Section: React.FC<{
  heading: string;
  help?: string;
  children: React.ReactNode;
  testId?: string;
}> = ({ heading, help, children, testId }) => (
  <section className="flex flex-col gap-2" data-testid={testId}>
    <div className="flex items-center gap-1">
      <h3 className="text-xl font-normal text-typography-900">{heading}</h3>
      {help && <InfoTip label={help} ariaLabel={`About ${heading}`} />}
    </div>
    {children}
  </section>
);

interface ReleaseDrawerProps {
  /** The release to show; null keeps the drawer closed. */
  releaseId: string | null;
  /** From the list, so the title and status show before the bundle has loaded. */
  summary?: AllyGuideRelease;
  canEdit: boolean;
  onPromote: (release: AllyGuideRelease) => void;
  /** Start a canary of this release, or change the share of one already running. */
  onStartCanary: (release: AllyGuideRelease) => void;
  onStopCanary: (release: AllyGuideRelease) => void;
  /** Start an eval run (smoke or gate) of this release. */
  onRunEvals: (release: AllyGuideRelease) => void;
  onClose: () => void;
}

const DrawerBody: React.FC<{
  releaseId: string;
  canEdit: boolean;
  onPromote: (release: AllyGuideRelease) => void;
  onStartCanary: (release: AllyGuideRelease) => void;
  onStopCanary: (release: AllyGuideRelease) => void;
  onRunEvals: (release: AllyGuideRelease) => void;
}> = ({ releaseId, canEdit, onPromote, onStartCanary, onStopCanary, onRunEvals }) => {
  const strings = en.allyConsole.releases.detail;
  const { data, isLoading, isError, error, refetch } = useGetAllyGuideReleaseQuery(releaseId);

  const policyRows = useMemo(() => flattenToRows(data?.bundle?.policy), [data]);
  const routingRows = useMemo(() => flattenToRows(data?.bundle?.modelRouting), [data]);
  const capabilityRows = useMemo<KeyValueRow[]>(
    () =>
      Object.entries(data?.bundle?.capabilities ?? {}).map(([key, on]) => ({
        key,
        value: on ? strings.on : strings.off,
      })),
    [data, strings.on, strings.off],
  );

  if (isLoading) return <LoadingBlock lines={8} />;
  if (isError || !data) {
    return <ErrorPanel what="this release" error={error} onRetry={() => void refetch()} />;
  }

  const prompts = Object.entries<AllyGuidePromptRef>(data.bundle?.prompts ?? {});
  const meta: [string, React.ReactNode, string?][] = [
    [strings.meta.author, en.allyConsole.releases.authors[data.authorKind] ?? data.authorKind],
    [
      strings.meta.hash,
      <span key="hash" className="font-mono">
        {data.contentHash.slice(0, 12)}
      </span>,
      strings.hashHelp,
    ],
    ...(data.status === "canary"
      ? ([
          [
            strings.shareMeta,
            data.rolloutPercent === null || data.rolloutPercent === undefined
              ? "—"
              : `${data.rolloutPercent}%`,
            strings.canaryHelp,
          ],
        ] as [string, React.ReactNode, string?][])
      : []),
    [strings.meta.created, formatDateTime(data.createdAt)],
    [
      strings.meta.promoted,
      data.promotedAt ? formatDateTime(data.promotedAt) : en.allyConsole.releases.notPromoted,
    ],
    ...(data.retiredAt
      ? ([[strings.meta.retired, formatDateTime(data.retiredAt)]] as [string, React.ReactNode][])
      : []),
    [strings.meta.notes, data.notes ?? en.allyConsole.releases.noNotes],
  ];

  return (
    <div className="flex flex-col gap-8" data-testid="release-detail">
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {meta.map(([label, value, help]) => (
          <div key={label} className="flex flex-col gap-0.5">
            <dt className="flex items-center gap-1 text-xs tracking-wide text-typography-700">
              {label}
              {help && <InfoTip label={help} ariaLabel={`About ${label}`} />}
            </dt>
            <dd className="break-words text-sm text-typography-900">{value}</dd>
          </div>
        ))}
      </dl>

      {data.status === "canary" && (
        <p className="text-sm text-typography-800" data-testid="release-canary-note">
          {strings.canaryRunning(data.rolloutPercent ?? null)}
        </p>
      )}
      {canEdit && (
        <div className="flex flex-wrap gap-3">
          {data.status !== "ga" && (
            <Button kind="primary" size="md" onClick={() => onPromote(data)}>
              {strings.promote}
            </Button>
          )}
          <Button kind="tertiary" size="md" onClick={() => onRunEvals(data)}>
            {en.allyConsole.evals.runs.start}
          </Button>
          {canStartCanary(data.status) && (
            <Button kind="tertiary" size="md" onClick={() => onStartCanary(data)}>
              {data.status === "canary" ? strings.changeCanary : strings.startCanary}
            </Button>
          )}
          {data.status === "canary" && (
            <Button kind="danger--tertiary" size="md" onClick={() => onStopCanary(data)}>
              {strings.stopCanary}
            </Button>
          )}
        </div>
      )}
      {data.status === "ga" && <p className="text-sm text-typography-700">{strings.promoteGa}</p>}

      <Section heading={strings.promptsHeading} help={strings.promptsHelp} testId="release-prompts">
        {prompts.length === 0 ? (
          <p className="text-sm text-typography-700">{strings.promptsNone}</p>
        ) : (
          prompts.map(([role, prompt]) => (
            <div key={role} className="flex flex-col gap-1">
              <h4 className="text-sm font-semibold text-typography-900">
                {strings.promptHeading(role, prompt.code, prompt.version)}
              </h4>
              {/* A read-only region, not a disabled field: it must stay selectable and copyable. */}
              <pre
                className={PRE_CLASSES}
                tabIndex={0}
                aria-label={`${role} prompt`}
                data-testid="release-prompt"
              >
                {prompt.text}
              </pre>
            </div>
          ))
        )}
      </Section>

      <Section heading={strings.policyHeading} help={strings.policyHelp} testId="release-policy">
        {policyRows.length === 0 ? (
          <p className="text-sm text-typography-700">{strings.policyNone}</p>
        ) : (
          <KeyValueTable rows={policyRows} testId="release-policy-table" />
        )}
      </Section>

      {routingRows.length > 0 && (
        <Section heading={strings.routingHeading} help={strings.routingHelp}>
          <KeyValueTable rows={routingRows} testId="release-routing-table" />
        </Section>
      )}

      {capabilityRows.length > 0 && (
        <Section heading={strings.capabilitiesHeading} help={strings.capabilitiesHelp}>
          <KeyValueTable rows={capabilityRows} testId="release-capabilities-table" />
        </Section>
      )}
    </div>
  );
};

/**
 * One release in full. Prompts are shown as the text the models are given (monospace, read-only,
 * selectable) and the policy as a flat key/value table, because nested numbers cannot be compared
 * between releases any other way. Nothing here is editable: a release is immutable, and changing one
 * means creating the next.
 */
export const ReleaseDrawer: React.FC<ReleaseDrawerProps> = ({
  releaseId,
  summary,
  canEdit,
  onPromote,
  onStartCanary,
  onStopCanary,
  onRunEvals,
  onClose,
}) => {
  const strings = en.allyConsole.releases.detail;
  const title = (
    <div className="flex min-w-0 items-center gap-3">
      <h2 className="truncate text-lg font-semibold text-typography-900">
        {summary
          ? strings.title(releaseVersionLabel(summary.version))
          : releaseId
            ? shortId(releaseId)
            : ""}
      </h2>
      {summary && (
        <ReleaseStatusPill status={summary.status} rolloutPercent={summary.rolloutPercent} />
      )}
    </div>
  );
  return (
    <SidePanel
      open={releaseId !== null}
      onClose={onClose}
      title={title}
      closeLabel={strings.close}
      className="w-[min(860px,100vw)]"
    >
      {releaseId && (
        <DrawerBody
          key={releaseId}
          releaseId={releaseId}
          canEdit={canEdit}
          onPromote={onPromote}
          onStartCanary={onStartCanary}
          onStopCanary={onStopCanary}
          onRunEvals={onRunEvals}
        />
      )}
    </SidePanel>
  );
};
