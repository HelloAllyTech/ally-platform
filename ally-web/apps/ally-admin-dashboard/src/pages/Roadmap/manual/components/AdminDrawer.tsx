import React, { useEffect, useRef, useState } from "react";

import { toast } from "sonner";

import {
  Button,
  CarbonToggle,
  NumberInput,
  ProgressBar,
  SidePanel,
  SkeletonText,
  Tag,
  TextInput,
} from "@ally-ui-mono/ui-shared";
import {
  useCreateManualAgentKeyMutation,
  useDismissManualProposalMutation,
  useGetManualAdminSettingsQuery,
  useGetManualAgentKeysQuery,
  useGetManualProposalsQuery,
  useGetManualRunsQuery,
  useImportManualPagesMutation,
  useRevokeManualAgentKeyMutation,
  useRunManualAgentNowMutation,
  useUpdateManualAdminSettingsMutation,
} from "@api";
import { ApiEndpoints, en } from "@constants";
import type { ManualImportPage, ManualImportResult, ManualState } from "@types";
import { formatDate, formatRelativeTime } from "@utils";

import { mcpEndpoint, testConnection } from "../../../ContextLibrary/insightsFormat";
import { AGENT_TARGETS, KEY_PLACEHOLDER, snippetFor } from "../utils/agentConnect";
import { IMPORT_MAX_FILE_BYTES, chunkImportPages, parseImportBundle } from "../utils/importBundle";

import type { ConnectionOutcome } from "../../../ContextLibrary/insightsFormat";
import type { AgentTarget } from "../utils/agentConnect";

const usd = (value: number | null | undefined): string =>
  `$${(value ?? 0).toFixed((value ?? 0) < 10 ? 2 : 0)}`;

const statusOf = (error: unknown): number | undefined =>
  (error as { status?: number } | undefined)?.status;

const Section: React.FC<{ title: string; help?: string; children: React.ReactNode }> = ({
  title,
  help,
  children,
}) => (
  <section className="flex flex-col gap-3 border-b border-border-light pb-5">
    <div>
      <h3 className="m-0 text-sm font-semibold text-typography-900">{title}</h3>
      {help && <p className="m-0 mt-1 text-xs text-typography-600">{help}</p>}
    </div>
    {children}
  </section>
);

const SettingsSection: React.FC<{ state: ManualState | undefined }> = ({ state }) => {
  const copy = en.productManual.admin;
  const { data, isLoading, isError } = useGetManualAdminSettingsQuery();
  const [update, { isLoading: saving }] = useUpdateManualAdminSettingsMutation();
  const [budget, setBudget] = useState<number | "">("");
  useEffect(() => {
    if (data) setBudget(data.monthlyBudgetUsd);
  }, [data]);
  if (isLoading) return <SkeletonText paragraph lineCount={3} />;
  if (isError || !data) return <p className="m-0 text-sm">{copy.loadFailed}</p>;
  const valid = typeof budget === "number" && budget >= 1 && budget <= 2000;
  const save = async (patch: { enabled?: boolean; monthlyBudgetUsd?: number }) => {
    try {
      await update(patch).unwrap();
      toast.success(copy.saved);
    } catch {
      toast.error(copy.saveFailed);
    }
  };
  const spend = state?.budget;
  const cap = spend?.monthlyBudgetUsd || data.monthlyBudgetUsd || 1;
  return (
    <>
      <Section title={copy.enabled} help={copy.enabledHelp}>
        <CarbonToggle
          id="manual-admin-enabled"
          size="sm"
          labelText={copy.enabled}
          hideLabel
          labelA={copy.off}
          labelB={copy.on}
          toggled={data.enabled}
          disabled={saving}
          onToggle={(on: boolean) => void save({ enabled: on })}
        />
      </Section>
      <Section title={copy.budget} help={copy.budgetHelp}>
        <div className="flex items-end gap-2">
          <NumberInput
            id="manual-admin-budget"
            label={copy.budget}
            hideLabel
            min={1}
            max={2000}
            step={10}
            value={budget}
            invalid={budget !== "" && !valid}
            invalidText={copy.budgetInvalid}
            onChange={(_event: unknown, { value }: { value: number | string }) =>
              setBudget(value === "" ? "" : Number(value))
            }
            className="max-w-[12rem]"
          />
          <Button
            kind="tertiary"
            size="md"
            disabled={!valid || saving || budget === data.monthlyBudgetUsd}
            onClick={() => valid && void save({ monthlyBudgetUsd: budget as number })}
          >
            {copy.saveSettings}
          </Button>
        </div>
        {spend && (
          <div className="flex flex-col gap-1">
            <ProgressBar
              label={copy.spend}
              value={Math.min(100, (spend.spentUsd / cap) * 100)}
              max={100}
              helperText={copy.spent(usd(spend.spentUsd), usd(spend.monthlyBudgetUsd))}
              size="small"
            />
            {spend.reservedUsd > 0 && (
              <p className="m-0 text-xs text-typography-600">
                {copy.reserved(usd(spend.reservedUsd))}
              </p>
            )}
          </div>
        )}
      </Section>
    </>
  );
};

const RunsSection: React.FC<{ running: boolean }> = ({ running }) => {
  const copy = en.productManual.admin;
  const { data: runs = [], isLoading } = useGetManualRunsQuery();
  const [run, { isLoading: starting }] = useRunManualAgentNowMutation();
  const runNow = async () => {
    try {
      await run().unwrap();
      toast.success(copy.runStarted);
    } catch (error) {
      toast.error(statusOf(error) === 409 ? copy.runBusy : copy.runFailed);
    }
  };
  return (
    <Section title={copy.runs}>
      <Button
        kind="secondary"
        size="sm"
        disabled={starting || running}
        onClick={runNow}
        className="self-start"
      >
        {running || starting ? copy.running : copy.runNow}
      </Button>
      {isLoading ? (
        <SkeletonText paragraph lineCount={3} />
      ) : runs.length === 0 ? (
        <p className="m-0 text-sm text-typography-600">{copy.noRuns}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {runs.map(item => {
            const when = item.finishedAt ?? item.startedAt;
            return (
              <li key={item.id} className="flex flex-col gap-0.5 text-sm">
                <span className="flex items-center gap-2 text-typography-900">
                  {item.status && (
                    <Tag type="gray" size="sm" className="!m-0">
                      {item.status}
                    </Tag>
                  )}
                  {when && <span title={formatDate(when)}>{formatRelativeTime(when)}</span>}
                  {typeof item.spentUsd === "number" && (
                    <span className="text-typography-600">{usd(item.spentUsd)}</span>
                  )}
                </span>
                {item.summary && (
                  <span className="text-xs leading-relaxed text-typography-600">
                    {item.summary}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
};

const ProposalsSection: React.FC = () => {
  const copy = en.productManual.admin;
  const { data: proposals = [], isLoading } = useGetManualProposalsQuery();
  const [dismiss] = useDismissManualProposalMutation();
  return (
    <Section title={copy.proposals}>
      {isLoading ? (
        <SkeletonText paragraph lineCount={3} />
      ) : proposals.length === 0 ? (
        <p className="m-0 text-sm text-typography-600">{copy.noProposals}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {proposals.map(proposal => (
            <li key={proposal.id} className="flex items-start gap-2">
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex flex-wrap items-center gap-2 text-sm text-typography-900">
                  {proposal.kind && (
                    <Tag type="blue" size="sm" className="!m-0">
                      {proposal.kind}
                    </Tag>
                  )}
                  {proposal.summary}
                </span>
                {(proposal.pageSlug || proposal.prRef) && (
                  <span className="text-xs text-typography-600">
                    {[proposal.pageSlug, proposal.prRef].filter(Boolean).join(" · ")}
                  </span>
                )}
              </div>
              <Button
                kind="ghost"
                size="sm"
                onClick={() =>
                  dismiss(proposal.id)
                    .unwrap()
                    .then(() => toast.success(copy.proposalDismissed))
                    .catch(() => toast.error(copy.saveFailed))
                }
              >
                {copy.dismissProposal}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
};

const readText = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });

const MAX_SHOWN_REFUSALS = 10;

/**
 * Import pages from a JSON file (the same shape the authored bundle has). The file is checked in the
 * browser, then sent in parts so each request stays small; the server still scrubs every page.
 */
export const ImportSection: React.FC = () => {
  const copy = en.productManual.admin;
  const inputRef = useRef<HTMLInputElement>(null);
  const [importPages] = useImportManualPagesMutation();
  const [file, setFile] = useState<{ name: string; pages: ManualImportPage[] } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<ManualImportResult | null>(null);
  const [stopped, setStopped] = useState(false);

  const pick = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0];
    event.target.value = "";
    setFile(null);
    setProblem(null);
    setResult(null);
    setStopped(false);
    if (!picked) return;
    if (picked.size > IMPORT_MAX_FILE_BYTES) {
      setProblem(copy.importTooBig);
      return;
    }
    const parsed = parseImportBundle(await readText(picked));
    if ("pages" in parsed) {
      setFile({ name: picked.name, pages: parsed.pages });
      return;
    }
    setProblem(
      parsed.error === "notJson"
        ? copy.importNotJson
        : parsed.error === "shape"
          ? copy.importShape
          : parsed.error === "empty"
            ? copy.importEmpty
            : parsed.error === "tooMany"
              ? copy.importTooMany
              : copy.importBadPage(parsed.position ?? 0),
    );
  };

  const run = async () => {
    if (!file) return;
    const chunks = chunkImportPages(file.pages);
    const totals: ManualImportResult = { created: 0, updated: 0, unchanged: 0, errors: [] };
    setStopped(false);
    setResult(null);
    try {
      for (let index = 0; index < chunks.length; index += 1) {
        setProgress({ done: index + 1, total: chunks.length });
        const part = await importPages(chunks[index]).unwrap();
        totals.created += part.created;
        totals.updated += part.updated;
        totals.unchanged += part.unchanged;
        totals.errors.push(...(part.errors ?? []));
        setResult({ ...totals });
      }
    } catch {
      setStopped(true);
      toast.error(copy.importFailed);
    } finally {
      setProgress(null);
    }
  };

  return (
    <Section title={copy.importTitle} help={copy.importHelp}>
      <input
        ref={inputRef}
        type="file"
        accept="application/json,.json"
        className="sr-only"
        aria-label={copy.importChoose}
        tabIndex={-1}
        onChange={pick}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button
          kind="secondary"
          size="sm"
          disabled={!!progress}
          onClick={() => inputRef.current?.click()}
        >
          {copy.importChoose}
        </Button>
        {file && (
          <span className="text-sm text-typography-600">
            {copy.importChosen(file.name, file.pages.length)}
          </span>
        )}
      </div>
      {problem && (
        <p role="alert" className="m-0 text-sm text-typography-900">
          {problem}
        </p>
      )}
      {file && (
        <Button kind="primary" size="sm" disabled={!!progress} onClick={run} className="self-start">
          {progress
            ? copy.importRunning(progress.done, progress.total)
            : copy.importRun(file.pages.length)}
        </Button>
      )}
      {result && (
        <div role="status" className="flex flex-col gap-1 text-sm text-typography-900">
          <span>{copy.importDone(result.created, result.updated, result.unchanged)}</span>
          {result.errors.length > 0 && (
            <>
              <span className="font-semibold">{copy.importRefused}</span>
              <ul className="m-0 list-disc pl-5 text-xs text-typography-600">
                {result.errors.slice(0, MAX_SHOWN_REFUSALS).map(message => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
              {result.errors.length > MAX_SHOWN_REFUSALS && (
                <span className="text-xs text-typography-600">
                  {copy.importMore(result.errors.length - MAX_SHOWN_REFUSALS)}
                </span>
              )}
            </>
          )}
        </div>
      )}
      {stopped && (
        <p role="alert" className="m-0 text-sm text-typography-900">
          {copy.importFailed}
        </p>
      )}
    </Section>
  );
};

const copyText = async (text: string) => {
  const copy = en.productManual.admin;
  try {
    await navigator.clipboard.writeText(text);
    toast.success(copy.copied);
  } catch {
    toast.error(copy.copyFailed);
  }
};

/** A command or config to paste, with its own Copy button. */
const CodeBlock: React.FC<{ text: string; label: string; testId?: string }> = ({
  text,
  label,
  testId,
}) => (
  <div className="flex flex-col gap-1">
    <pre
      className="m-0 overflow-x-auto whitespace-pre-wrap break-all bg-neutral-100 p-3 font-mono text-xs"
      data-testid={testId}
    >
      {text}
    </pre>
    <div>
      <Button kind="tertiary" size="sm" onClick={() => void copyText(text)}>
        {label}
      </Button>
    </div>
  </div>
);

/** Read when the section mounts, never at module load. */
const agentEndpoint = (): string =>
  mcpEndpoint(
    import.meta.env.VITE_API_BASE_URL,
    typeof window === "undefined" ? "http://localhost" : window.location.origin,
    ApiEndpoints.PRODUCT_MANUAL.MCP,
  );

/**
 * Connect a coding agent, in the order a developer does it: make a key, paste one command for
 * their agent, check it works. The key is shown once; the commands fill in with it so there is
 * nothing to assemble by hand. Test connection is offered only while this page still holds the key.
 */
export const KeysSection: React.FC = () => {
  const copy = en.productManual.admin;
  const { data: keys = [], isLoading } = useGetManualAgentKeysQuery();
  const [create, { isLoading: creating }] = useCreateManualAgentKeyMutation();
  const [revoke] = useRevokeManualAgentKeyMutation();
  const [url] = useState(agentEndpoint);
  const [label, setLabel] = useState("");
  const [fresh, setFresh] = useState<{ label: string; key: string } | null>(null);
  const [target, setTarget] = useState<AgentTarget>("claude-code");
  const [testing, setTesting] = useState(false);
  const [outcome, setOutcome] = useState<ConnectionOutcome | null>(null);
  const onCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    const name = label.trim();
    if (!name) return;
    try {
      const result = await create({ label: name }).unwrap();
      setLabel("");
      setFresh({ label: name, key: result.key });
      setOutcome(null);
    } catch {
      toast.error(copy.saveFailed);
    }
  };
  const onTest = async () => {
    if (!fresh) return;
    setTesting(true);
    setOutcome(null);
    try {
      setOutcome(await testConnection(url, fresh.key));
    } finally {
      setTesting(false);
    }
  };
  const key = fresh?.key ?? KEY_PLACEHOLDER;
  const stepTitle = "m-0 text-sm font-semibold text-typography-900";
  return (
    <Section title={copy.keys} help={copy.keysHelp}>
      <div className="flex flex-col gap-2" data-testid="manual-agent-step-create">
        <h4 className={stepTitle}>{copy.stepCreate}</h4>
        <p className="m-0 text-xs text-typography-600">{copy.stepCreateHelp}</p>
        {fresh ? (
          <div
            className="flex flex-col gap-2 border border-amber-300 bg-amber-50 p-3"
            role="status"
            data-testid="manual-agent-fresh"
          >
            <p className="m-0 text-sm font-semibold text-typography-900">
              {copy.newKeyHeading(fresh.label)}
            </p>
            <p className="m-0 text-xs text-amber-800">{copy.keyWarning}</p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 break-all bg-white px-3 py-2 font-mono text-xs">
                {fresh.key}
              </code>
              <Button kind="tertiary" size="sm" onClick={() => void copyText(fresh.key)}>
                {copy.copyKey}
              </Button>
            </div>
            <div>
              <Button
                kind="ghost"
                size="sm"
                onClick={() => {
                  setFresh(null);
                  setOutcome(null);
                }}
              >
                {copy.done}
              </Button>
            </div>
          </div>
        ) : (
          <form className="flex items-end gap-2" onSubmit={event => void onCreate(event)}>
            <TextInput
              id="manual-admin-key-label"
              labelText={copy.keyLabel}
              placeholder={copy.keyPlaceholder}
              size="md"
              maxLength={80}
              value={label}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                setLabel(event.target.value)
              }
            />
            <Button kind="tertiary" size="md" type="submit" disabled={!label.trim() || creating}>
              {creating ? copy.creatingKey : copy.createKey}
            </Button>
          </form>
        )}
      </div>

      <div className="flex flex-col gap-2" data-testid="manual-agent-step-add">
        <h4 className={stepTitle}>{copy.stepAdd}</h4>
        {!fresh && <p className="m-0 text-xs text-typography-600">{copy.stepAddNoKey}</p>}
        <div role="tablist" aria-label={copy.stepAdd} className="flex flex-wrap gap-1">
          {AGENT_TARGETS.map(item => (
            <Button
              key={item}
              role="tab"
              aria-selected={target === item}
              kind={target === item ? "primary" : "tertiary"}
              size="sm"
              onClick={() => setTarget(item)}
            >
              {copy.targets[item]}
            </Button>
          ))}
        </div>
        <div role="tabpanel" className="flex flex-col gap-2">
          {copy.targetHelp[target].map(line => (
            <p key={line} className="m-0 text-xs text-typography-700">
              {line}
            </p>
          ))}
          {target === "other" && (
            <p className="m-0 break-all text-xs text-typography-700">
              <span className="font-semibold">URL: </span>
              <code>{url}</code>
            </p>
          )}
          <CodeBlock
            text={snippetFor(target, url, key)}
            label={copy.copySnippet}
            testId="manual-agent-snippet"
          />
          <p className="m-0 text-xs text-typography-600">{copy.keepSecret}</p>
        </div>
      </div>

      <div className="flex flex-col gap-2" data-testid="manual-agent-step-test">
        <h4 className={stepTitle}>{copy.stepTest}</h4>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            kind="tertiary"
            size="sm"
            disabled={!fresh || testing}
            onClick={() => void onTest()}
          >
            {testing ? copy.testing : copy.testConnection}
          </Button>
          {!fresh && <span className="text-xs text-typography-600">{copy.testNeedsKey}</span>}
        </div>
        <p
          aria-live="polite"
          data-testid="manual-agent-test-result"
          data-outcome={outcome ?? undefined}
          className={`m-0 text-xs ${
            outcome === "reachable" ? "text-green-700" : outcome ? "text-red-700" : "sr-only"
          }`}
        >
          {outcome ? copy.testResult[outcome] : ""}
        </p>
        <p className="m-0 text-xs text-typography-700">{copy.askAgent}</p>
        <p className="m-0 text-xs text-typography-600">{copy.whatHappens}</p>
      </div>

      <div className="flex flex-col gap-2">
        <h4 className={stepTitle}>{copy.keysHeading}</h4>
        {isLoading ? (
          <SkeletonText paragraph lineCount={2} />
        ) : keys.length === 0 ? (
          <p className="m-0 text-sm text-typography-600">{copy.noKeys}</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {keys.map(item => (
              <li key={item.id} className="flex items-center gap-2 text-sm">
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="text-typography-900">
                    {item.label}{" "}
                    <code className="text-xs text-typography-600">{item.keyPrefix}…</code>
                  </span>
                  <span className="text-xs text-typography-600">
                    {item.lastUsedAt
                      ? copy.lastUsed(formatRelativeTime(item.lastUsedAt))
                      : copy.neverUsed}
                  </span>
                </div>
                {item.revokedAt ? (
                  <Tag type="gray" size="sm">
                    {copy.revoked}
                  </Tag>
                ) : (
                  <Button
                    kind="ghost"
                    size="sm"
                    onClick={() =>
                      revoke(item.id)
                        .unwrap()
                        .catch(() => toast.error(copy.saveFailed))
                    }
                  >
                    {copy.revoke}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  );
};

/**
 * Manual settings, for people who run it (`canAdminister`): weekly updates on/off, the monthly
 * budget and this month's spend, Run now and recent runs, open proposals, and agent keys.
 */
export const AdminDrawer: React.FC<{
  open: boolean;
  onClose: () => void;
  state: ManualState | undefined;
}> = ({ open, onClose, state }) => {
  const copy = en.productManual.admin;
  return (
    <SidePanel
      open={open}
      onClose={onClose}
      side="right"
      width="30rem"
      title={copy.title}
      closeLabel={copy.close}
    >
      {open && (
        <div className="ally-v2 flex flex-col gap-5 px-1">
          <SettingsSection state={state} />
          <RunsSection running={state?.agentState === "running"} />
          <ProposalsSection />
          <ImportSection />
          <KeysSection />
        </div>
      )}
    </SidePanel>
  );
};
