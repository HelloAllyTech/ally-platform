import React, { useMemo, useState } from "react";

import {
  Button,
  Checkbox,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@ally-ui-mono/ui-shared";
import { useGetAllyGuideThreadConfigQuery } from "@api";
import { describeValue, groupFields } from "@components/ally-guide/configDraft";
import { ErrorPanel, LoadingBlock } from "@components/ally-guide/ConsoleStates";
import { InfoTip } from "@components/ally-guide/InfoTip";
import { lazyCopy } from "@components/ally-guide/lazyCopy";
import { Pill } from "@components/ally-guide/Pill";
import { en } from "@constants";
import { AllyGuideConfigExplainEntry } from "@types";

const strings = lazyCopy(() => en.allyConsole.config.effective);
const valueStrings = lazyCopy(() => en.allyConsole.config.form);
const show = (value: unknown, unit?: string | null) =>
  describeValue(value, unit, {
    off: valueStrings.off,
    yes: valueStrings.yes,
    no: valueStrings.no,
  });

/** A value differs from the release when it came from anywhere but the release, or is about to. */
const differs = (entry: AllyGuideConfigExplainEntry) =>
  entry.source !== "release" || entry.pending !== null;

const Body: React.FC<{ threadId: string }> = ({ threadId }) => {
  const { data, isLoading, isError, error, refetch } = useGetAllyGuideThreadConfigQuery(threadId);
  const [onlyDiffering, setOnlyDiffering] = useState(true);

  const grouped = useMemo(() => {
    const entries = (data?.entries ?? []).filter(entry => !onlyDiffering || differs(entry));
    return groupFields(entries);
  }, [data, onlyDiffering]);

  if (isLoading) return <LoadingBlock lines={4} />;
  if (isError || !data) {
    return <ErrorPanel what={strings.loadFailed} error={error} onRetry={() => void refetch()} />;
  }

  const runtime = data.runtime;
  return (
    <div className="flex flex-col gap-4" data-testid="effective-config">
      <p className="text-sm text-typography-800" data-testid="effective-config-epoch">
        {strings.epoch(data.epoch, data.releaseVersion === null ? null : `v${data.releaseVersion}`)}
      </p>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {(
          [
            ["mode", en.allyConsole.modes[runtime.mode] ?? runtime.mode],
            ["tier", runtime.tier ?? "—"],
            ["model", runtime.model ?? "—"],
            [
              "guidance",
              en.allyConsole.playground.guidance.options[runtime.guidance] ?? runtime.guidance,
            ],
            ["visitor", runtime.visitor ? valueStrings.yes : valueStrings.no],
          ] as const
        ).map(([key, value]) => (
          <div key={key} className="flex flex-col gap-0.5">
            <dt className="text-xs tracking-wide text-typography-700">{strings.runtime[key]}</dt>
            <dd className="break-words text-sm text-typography-900">{value}</dd>
          </div>
        ))}
      </dl>

      {data.nextReleaseId && (
        <p className="text-sm text-typography-800" data-testid="effective-next-release">
          {strings.nextRelease}
        </p>
      )}
      {data.overridesPending && (
        <p className="text-sm text-typography-800" data-testid="effective-overrides-pending">
          {strings.overridesPending}
        </p>
      )}

      <Checkbox
        id="effective-only-differing"
        labelText={strings.onlyDiffering}
        checked={onlyDiffering}
        onChange={(_event: unknown, { checked }: { checked: boolean }) => setOnlyDiffering(checked)}
      />

      {grouped.length === 0 ? (
        <p className="text-sm text-typography-700" data-testid="effective-all-same">
          {strings.allSame}
        </p>
      ) : (
        grouped.map(([group, entries]) => (
          <div key={group} className="flex flex-col gap-1">
            <h4 className="text-base font-semibold text-typography-900">{group}</h4>
            <div className="overflow-x-auto">
              <Table
                className="w-full border-collapse text-left"
                data-testid={`effective-group-${group}`}
              >
                <TableHead>
                  <TableRow className="border-b border-border-light text-xs text-typography-700">
                    <TableHeader className="py-2 pr-4 font-medium">
                      {strings.columns.setting}
                    </TableHeader>
                    <TableHeader className="py-2 pr-4 font-medium">
                      {strings.columns.value}
                    </TableHeader>
                    <TableHeader className="py-2 pr-4 font-medium">
                      {strings.columns.from}
                    </TableHeader>
                    <TableHeader className="py-2 pr-4 font-medium">
                      {strings.columns.release}
                    </TableHeader>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {entries.map(entry => (
                    <TableRow
                      key={entry.key}
                      className="border-b border-border-light align-top text-sm text-typography-900"
                      data-testid={`effective-row-${entry.key}`}
                    >
                      <TableCell className="py-2 pr-4">
                        <span className="inline-flex items-center gap-1">
                          <span className="font-mono text-xs">{entry.key}</span>
                          <InfoTip label={entry.description} ariaLabel={`About ${entry.key}`} />
                        </span>
                      </TableCell>
                      <TableCell className="py-2 pr-4 tabular-nums">
                        {show(entry.value, entry.unit)}
                        {entry.pending && (
                          <span className="block text-xs text-typography-700">
                            {strings.pending(
                              show(entry.pending.value, entry.unit),
                              strings.sources[entry.pending.source] ?? entry.pending.source,
                            )}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="py-2 pr-4">
                        <Pill tone={entry.source === "release" ? "neutral" : "info"}>
                          {strings.sources[entry.source] ?? entry.source}
                        </Pill>
                        {entry.chain.find(link => link.reason) && (
                          <span className="block text-xs text-typography-700">
                            {entry.chain.find(link => link.reason)?.reason}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="py-2 pr-4 tabular-nums">
                        {show(entry.releaseValue, entry.unit)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        ))
      )}

      {data.ignored.length > 0 && (
        <div data-testid="effective-ignored">
          <h4 className="flex items-center gap-1 text-base font-semibold text-typography-900">
            {strings.ignoredHeading}
            <InfoTip label={strings.ignoredHelp} ariaLabel="About ignored values" />
          </h4>
          <ul className="list-disc pl-6 text-sm text-typography-800">
            {data.ignored.map((item, index) => (
              <li key={`${item.key}-${index}`}>
                <span className="font-mono text-xs">{item.key}</span>: {item.why}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

/**
 * The Effective config explainer for one conversation: every setting it runs on and which level
 * each value came from (release, organisation, course, the learner's own choice, or the safety mode),
 * with a value that will change at the next epoch marked. It starts shut and asks the server only
 * when opened, and shows just what differs from the release unless asked for everything. No learner
 * text is in it, so it is open to anyone who can see the Console.
 */
export const EffectiveConfigPanel: React.FC<{ threadId: string }> = ({ threadId }) => {
  const [open, setOpen] = useState(false);
  return (
    <section className="flex flex-col gap-3" aria-labelledby="effective-config-heading">
      <div className="flex flex-wrap items-center gap-2">
        <h3 id="effective-config-heading" className="text-xl font-normal text-typography-900">
          {strings.heading}
        </h3>
        <InfoTip label={strings.help} ariaLabel="About the effective config" />
        <Button
          kind="tertiary"
          size="sm"
          aria-expanded={open}
          onClick={() => setOpen(value => !value)}
        >
          {open ? strings.hide : strings.show}
        </Button>
      </div>
      {open && <Body threadId={threadId} />}
    </section>
  );
};
