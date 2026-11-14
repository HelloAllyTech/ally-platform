import React, { useMemo, useState } from "react";

import { toast } from "sonner";

import {
  Button,
  CarbonDropdown as Dropdown,
  CarbonToggle,
  NumberInput,
  TextArea,
  TextInput,
} from "@ally-ui-mono/ui-shared";
import {
  useGetDebriefModelsQuery,
  useGetDebriefReleaseDetailQuery,
  useGetDebriefReleaseHistoryQuery,
  useGetPromptVersionsQuery,
  useProposeDebriefChangeMutation,
} from "@api";
import { ErrorPanel, LoadingBlock } from "@components/ally-guide/ConsoleStates";
import { en } from "@constants";
import { DebriefModelChoice, DebriefProposal } from "@types";
import { getErrorMessage } from "@utils";

import { promptName, stepName } from "../consoleLabels";

/** Steps the recipe can't run without; ally-be refuses to turn them off. */
const FIXED_STEPS = new Set(["safety_reader", "writer", "checks", "evaluator", "judge"]);

const ModelSelect: React.FC<{
  id: string;
  label: string;
  value: string;
  choices: DebriefModelChoice[];
  onChange: (model: string) => void;
}> = ({ id, label, value, choices, onChange }) => {
  const options = choices.some(c => c.model === value)
    ? choices
    : [{ model: value, label: value, provider: null }, ...choices];
  return (
    <div className="w-full min-w-[10rem]">
      <Dropdown
        id={id}
        size="sm"
        titleText={label}
        hideLabel
        label={label}
        items={options}
        selectedItem={options.find(c => c.model === value) ?? null}
        itemToString={(c: DebriefModelChoice | null) => c?.label ?? ""}
        onChange={({ selectedItem }: { selectedItem: DebriefModelChoice | null }) =>
          selectedItem && onChange(selectedItem.model)
        }
      />
    </div>
  );
};

type VersionItem = { id: string; label: string };

/** Pick a published Skills Store version of one prompt; the live release's version first. */
const PromptVersionPicker: React.FC<{
  code: string;
  promptId: string;
  current: number | null;
  value: number | null;
  onChange: (v: number) => void;
}> = ({ code, promptId, current, value, onChange }) => {
  const s = en.debriefs.pmPage.propose;
  const versions = useGetPromptVersionsQuery(promptId);
  const published = (versions.data ?? []).filter(v => v.status !== "candidate" && v.publishedAt);
  const items: VersionItem[] = published.map(v => ({
    id: String(v.version),
    label:
      v.version === current
        ? s.versionInRelease(v.version)
        : `${s.version(v.version)}${v.note ? ` · ${v.note}` : ""}`,
  }));
  if (current != null && !items.some(i => i.id === String(current))) {
    items.unshift({ id: String(current), label: s.versionInRelease(current) });
  }
  const selected = String(value ?? current ?? "");
  return (
    <div
      className="grid min-w-[640px] grid-cols-[180px_minmax(180px,1fr)_120px] items-center gap-3 border-b border-neutral-100 px-4 py-2 text-sm"
      data-testid="propose-prompt"
    >
      <span>{promptName(code)}</span>
      <div className="w-full min-w-[10rem]">
        <Dropdown
          id={`propose-prompt-${code}`}
          size="sm"
          titleText={promptName(code)}
          hideLabel
          label={promptName(code)}
          items={items}
          selectedItem={items.find(i => i.id === selected) ?? null}
          itemToString={(i: VersionItem | null) => i?.label ?? ""}
          onChange={({ selectedItem }: { selectedItem: VersionItem | null }) =>
            selectedItem && onChange(Number(selectedItem.id))
          }
        />
      </div>
      <span className="text-xs text-neutral-600">
        {versions.isLoading ? s.loadingVersions : ""}
      </span>
    </div>
  );
};

/**
 * "Propose a change" (replaces "Draft a new release"): a person's change to steps, models or
 * budgets becomes an idea with its own draft release, copied from the live one. It then climbs
 * the same test ladder as the PM agent's ideas; the live release is never edited. Budget fields
 * show only to the owner.
 */
export const ProposeChange: React.FC<{
  canChangeBudgets: boolean;
  onDone: (ideaId: string) => void;
  onCancel: () => void;
}> = ({ canChangeBudgets, onDone, onCancel }) => {
  const s = en.debriefs.pmPage.propose;
  const models = useGetDebriefModelsQuery();
  const [propose, { isLoading }] = useProposeDebriefChangeMutation();
  const [title, setTitle] = useState("");
  const [why, setWhy] = useState("");
  const [model, setModel] = useState<Record<string, string>>({});
  const [off, setOff] = useState<Record<string, boolean>>({});
  const [reply, setReply] = useState<string | null>(null);
  const [budgets, setBudgets] = useState<DebriefProposal["settings"]>({});
  const [prompts, setPrompts] = useState<Record<string, number>>({});
  // The live release's prompts (not the pinned rules, which have their own sign-off).
  const history = useGetDebriefReleaseHistoryQuery();
  const liveId = history.data?.items.find(r => r.status === "live")?.id;
  const live = useGetDebriefReleaseDetailQuery(liveId ?? "", { skip: !liveId });
  const livePrompts = (live.data?.contents.prompts ?? []).filter(
    x => x.lock === "release_only" && x.promptId,
  );

  const liveModels = useMemo(
    () => Object.fromEntries((models.data?.steps ?? []).map(st => [st.step, st.model ?? ""])),
    [models.data],
  );
  const stepChanges = (models.data?.steps ?? [])
    .map(st => {
      const m = model[st.step];
      const change: NonNullable<DebriefProposal["steps"]>[number] = { step: st.step };
      if (m && m !== liveModels[st.step]) change.model = m;
      if (off[st.step]) change.enabled = false;
      return change;
    })
    .filter(c => c.model !== undefined || c.enabled !== undefined);
  const budgetChanges = Object.fromEntries(
    Object.entries(budgets ?? {}).filter(([, v]) => v !== undefined && !Number.isNaN(v)),
  );
  const replyChange = reply && reply !== models.data?.reply ? reply : undefined;
  const promptChanges = Object.fromEntries(
    Object.entries(prompts).filter(
      ([code, v]) => v !== livePrompts.find(x => x.code === code)?.version,
    ),
  );
  const anything =
    stepChanges.length > 0 ||
    Object.keys(budgetChanges).length > 0 ||
    !!replyChange ||
    Object.keys(promptChanges).length > 0;

  const submit = async () => {
    try {
      const r = await propose({
        title: title.trim(),
        why: why.trim() || undefined,
        ...(stepChanges.length ? { steps: stepChanges } : {}),
        ...(Object.keys(budgetChanges).length ? { settings: budgetChanges } : {}),
        ...(replyChange ? { reply: replyChange } : {}),
        ...(Object.keys(promptChanges).length ? { prompts: promptChanges } : {}),
      }).unwrap();
      toast.success(r.budgetOnly ? s.doneBudget(r.version) : s.done(r.version));
      onDone(r.ideaId);
    } catch (e) {
      toast.error(getErrorMessage(e, en.debriefs.pmAgent.actionFailed));
    }
  };

  return (
    <section
      className="mx-8 mt-6 flex flex-col gap-4 rounded-sm border border-primary-200 bg-white px-6 py-5"
      data-testid="propose-change"
      aria-label={s.title}
    >
      <div>
        <h2 className="text-xl font-semibold">{s.title}</h2>
        <p className="mt-1 max-w-3xl text-sm text-neutral-600">{s.help}</p>
      </div>
      <TextInput
        id="propose-title"
        labelText={s.titleLabel}
        value={title}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTitle(e.target.value)}
      />
      <TextArea
        id="propose-why"
        labelText={s.whyLabel}
        rows={2}
        value={why}
        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setWhy(e.target.value)}
      />
      {models.isError ? (
        <ErrorPanel
          forbiddenMessage={en.debriefs.noAccess}
          what={en.debriefs.releases.models.loadFailed}
          error={models.error}
          onRetry={() => void models.refetch()}
        />
      ) : !models.data ? (
        <LoadingBlock lines={4} />
      ) : (
        <div className="overflow-x-auto rounded-sm bg-neutral-50">
          <div className="grid min-w-[640px] grid-cols-[180px_minmax(180px,1fr)_120px] gap-3 border-b border-neutral-100 px-4 py-2 text-xs text-neutral-600">
            <span>{s.cols.step}</span>
            <span>{s.cols.model}</span>
            <span>{s.cols.on}</span>
          </div>
          {models.data.steps.map(st => (
            <div
              key={st.step}
              className="grid min-w-[640px] grid-cols-[180px_minmax(180px,1fr)_120px] items-center gap-3 border-b border-neutral-100 px-4 py-2 text-sm"
              data-testid="propose-step"
            >
              <span>{stepName(st.step)}</span>
              <ModelSelect
                id={`propose-model-${st.step}`}
                label={stepName(st.step)}
                value={model[st.step] ?? st.model ?? ""}
                choices={models.data?.choices.steps ?? []}
                onChange={m => setModel({ ...model, [st.step]: m })}
              />
              {FIXED_STEPS.has(st.step) ? (
                <span className="text-xs text-neutral-600">{s.fixed}</span>
              ) : (
                <CarbonToggle
                  id={`propose-on-${st.step}`}
                  size="sm"
                  labelText={s.onLabel(stepName(st.step))}
                  hideLabel
                  toggled={!off[st.step]}
                  onToggle={(on: boolean) => setOff({ ...off, [st.step]: !on })}
                />
              )}
            </div>
          ))}
          <div className="grid min-w-[640px] grid-cols-[180px_minmax(180px,1fr)_120px] items-center gap-3 px-4 py-2 text-sm">
            <span>{stepName("ask_ally")}</span>
            <ModelSelect
              id="propose-model-ask-ally"
              label={stepName("ask_ally")}
              value={reply ?? models.data.reply}
              choices={models.data.choices.reply}
              onChange={setReply}
            />
            <span />
          </div>
        </div>
      )}
      {livePrompts.length > 0 && (
        <div className="overflow-x-auto rounded-sm bg-neutral-50" data-testid="propose-prompts">
          <div className="grid min-w-[640px] grid-cols-[180px_minmax(180px,1fr)_120px] gap-3 border-b border-neutral-100 px-4 py-2 text-xs text-neutral-600">
            <span>{s.cols.prompt}</span>
            <span>{s.cols.version}</span>
            <span />
          </div>
          {livePrompts.map(x => (
            <PromptVersionPicker
              key={x.code}
              code={x.code}
              promptId={x.promptId as string}
              current={x.version}
              value={prompts[x.code] ?? null}
              onChange={v => setPrompts({ ...prompts, [x.code]: v })}
            />
          ))}
        </div>
      )}
      {canChangeBudgets && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" data-testid="propose-budgets">
          {(["runCeilingUsd", "monthlyCapUsd", "passScore"] as const).map(k => (
            <NumberInput
              key={k}
              id={`propose-${k}`}
              label={s.budgets[k]}
              allowEmpty
              min={0}
              value={budgets?.[k] ?? ""}
              onChange={(_e: unknown, { value }: { value: number | string }) =>
                setBudgets({ ...budgets, [k]: value === "" ? undefined : Number(value) })
              }
            />
          ))}
        </div>
      )}
      <p className="text-xs text-neutral-600">{s.afterwards}</p>
      <div className="flex gap-2">
        <Button
          kind="primary"
          size="md"
          disabled={isLoading || !title.trim() || !anything}
          onClick={() => void submit()}
        >
          {s.submit}
        </Button>
        <Button kind="ghost" size="md" onClick={onCancel}>
          {en.debriefs.pmAgent.cancel}
        </Button>
      </div>
    </section>
  );
};
