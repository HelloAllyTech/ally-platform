import React, { useEffect, useState } from "react";

import { toast } from "sonner";

import {
  Button,
  CarbonToggle,
  Modal,
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
  useRevokeManualAgentKeyMutation,
  useRunManualAgentNowMutation,
  useUpdateManualAdminSettingsMutation,
} from "@api";
import { en } from "@constants";
import type { ManualState } from "@types";
import { formatDate, formatRelativeTime } from "@utils";

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

/** The new key, shown once with Copy. */
export const NewKeyModal: React.FC<{ keyValue: string | null; onClose: () => void }> = ({
  keyValue,
  onClose,
}) => {
  const copy = en.productManual.admin;
  return (
    <Modal
      open={!!keyValue}
      size="sm"
      modalHeading={copy.keyTitle}
      primaryButtonText={copy.done}
      onRequestClose={onClose}
      onRequestSubmit={onClose}
    >
      <p className="mb-3 text-sm font-semibold text-typography-900">{copy.keyWarning}</p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 break-all bg-neutral-100 px-3 py-2 font-mono text-sm">
          {keyValue}
        </code>
        <Button
          kind="tertiary"
          size="sm"
          onClick={() => {
            if (!keyValue) return;
            navigator.clipboard
              ?.writeText(keyValue)
              .then(() => toast.success(copy.copied))
              .catch(() => undefined);
          }}
        >
          {copy.copy}
        </Button>
      </div>
    </Modal>
  );
};

const KeysSection: React.FC = () => {
  const copy = en.productManual.admin;
  const { data: keys = [], isLoading } = useGetManualAgentKeysQuery();
  const [create, { isLoading: creating }] = useCreateManualAgentKeyMutation();
  const [revoke] = useRevokeManualAgentKeyMutation();
  const [label, setLabel] = useState("");
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const onCreate = async () => {
    const name = label.trim();
    if (!name) return;
    try {
      const result = await create({ label: name }).unwrap();
      setLabel("");
      setPlaintext(result.key);
    } catch {
      toast.error(copy.saveFailed);
    }
  };
  return (
    <Section title={copy.keys} help={copy.keysHelp}>
      <div className="flex items-end gap-2">
        <TextInput
          id="manual-admin-key-label"
          labelText={copy.keyLabel}
          size="md"
          value={label}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => setLabel(event.target.value)}
        />
        <Button kind="tertiary" size="md" disabled={!label.trim() || creating} onClick={onCreate}>
          {copy.createKey}
        </Button>
      </div>
      {isLoading ? (
        <SkeletonText paragraph lineCount={2} />
      ) : keys.length === 0 ? (
        <p className="m-0 text-sm text-typography-600">{copy.noKeys}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {keys.map(key => (
            <li key={key.id} className="flex items-center gap-2 text-sm">
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-typography-900">
                  {key.label} <code className="text-xs text-typography-600">{key.keyPrefix}…</code>
                </span>
                <span className="text-xs text-typography-600">
                  {key.lastUsedAt
                    ? copy.lastUsed(formatRelativeTime(key.lastUsedAt))
                    : copy.neverUsed}
                </span>
              </div>
              {key.revokedAt ? (
                <Tag type="gray" size="sm">
                  {copy.revoked}
                </Tag>
              ) : (
                <Button
                  kind="ghost"
                  size="sm"
                  onClick={() =>
                    revoke(key.id)
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
      <NewKeyModal keyValue={plaintext} onClose={() => setPlaintext(null)} />
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
          <KeysSection />
        </div>
      )}
    </SidePanel>
  );
};
