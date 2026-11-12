import React, { useMemo, useState } from "react";

import { toast } from "sonner";

import { Button, CarbonDropdown as Dropdown, TextArea } from "@ally-ui-mono/ui-shared";
import {
  useGetDebriefModelsQuery,
  useGetDebriefStepsQuery,
  useSetDebriefModelsMutation,
} from "@api";
import { formatUsd } from "@components/ally-guide/allyGuideFormat";
import { ConfirmDialog } from "@components/ally-guide/ConfirmDialog";
import { ErrorPanel, LoadingBlock } from "@components/ally-guide/ConsoleStates";
import { en } from "@constants";
import { DebriefModelChoice, DebriefStepUsage } from "@types";
import { getErrorMessage } from "@utils";

import { modelLabels, stepName } from "../consoleLabels";

const ASK_ALLY = "ask_ally";

const ModelSelect: React.FC<{
  id: string;
  label: string;
  value: string;
  choices: DebriefModelChoice[];
  onChange: (model: string) => void;
}> = ({ id, label, value, choices, onChange }) => {
  // The live model stays selectable even if the catalog no longer offers it.
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

const usedIn = (u: DebriefStepUsage | undefined) => {
  if (!u) return "—";
  if (u.usedShare != null) return `${Math.round(u.usedShare * 100)}%`;
  const all = u.done + u.failed + u.skipped;
  return all ? `${Math.round(((u.done + u.failed) / all) * 100)}%` : "—";
};

const GRID =
  "grid min-w-[860px] grid-cols-[160px_minmax(150px,1fr)_minmax(150px,1fr)_80px_80px_90px_70px] items-center gap-3 border-b border-neutral-100 px-3.5 py-2.5";

/**
 * The live release's "Steps and models" (redesign: the steps registry and the Models panel in one
 * table): each step's model and fallback, how often it runs, its cost, its paired-trial win rate,
 * and whether it is on. Changing a model makes a new release, checked like every release.
 */
export const StepsAndModels: React.FC<{ canEdit: boolean }> = ({ canEdit }) => {
  const s = en.debriefs.pmPage.steps;
  const m = en.debriefs.releases.models;
  const models = useGetDebriefModelsQuery();
  const usage = useGetDebriefStepsQuery();
  const [save, { isLoading }] = useSetDebriefModelsMutation();
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);

  const live = useMemo(() => {
    const d = models.data;
    if (!d) return {} as Record<string, string>;
    return {
      ...Object.fromEntries(d.steps.map(st => [st.step, st.model ?? ""])),
      [ASK_ALLY]: d.reply,
    };
  }, [models.data]);
  // The draft starts from the live release and again whenever that changes; adjusted while rendering.
  const [draft, setDraft] = useState<Record<string, string>>(live);
  const [draftOf, setDraftOf] = useState(live);
  if (draftOf !== live) {
    setDraftOf(live);
    setDraft(live);
  }
  const changed = Object.entries(draft).filter(([k, v]) => v && v !== live[k]);
  const label = modelLabels(models.data);

  const submit = async () => {
    const steps = Object.fromEntries(changed.filter(([k]) => k !== ASK_ALLY));
    const reply = changed.find(([k]) => k === ASK_ALLY)?.[1];
    try {
      const r = await save({
        ...(Object.keys(steps).length ? { steps } : {}),
        ...(reply ? { reply } : {}),
        note: note.trim() || undefined,
      }).unwrap();
      toast.success(m.saved(r.version));
      setConfirming(false);
      setNote("");
    } catch (e) {
      toast.error(getErrorMessage(e, m.failed));
    }
  };

  if (models.isError) {
    return (
      <ErrorPanel what={m.loadFailed} error={models.error} onRetry={() => void models.refetch()} />
    );
  }
  if (!models.data) return <LoadingBlock lines={5} />;
  const d = models.data;
  const use = new Map((usage.data ?? []).map(u => [u.step, u]));
  const model = (step: string, value: string, choices: DebriefModelChoice[]) =>
    canEdit ? (
      <ModelSelect
        id={`model-${step}`}
        label={stepName(step)}
        value={value}
        choices={choices}
        onChange={v => setDraft({ ...draft, [step]: v })}
      />
    ) : value ? (
      <span className="text-[13px]" title={value}>
        {label(value)}
      </span>
    ) : (
      "—"
    );
  const onLabel = (u: DebriefStepUsage | undefined, fixed?: boolean) =>
    fixed || u?.fixed ? s.fixed : u?.enabled === false ? s.off : s.on;
  const rows = [
    ...d.steps.map(st => {
      const u = use.get(st.step);
      return {
        key: st.step,
        cells: [
          stepName(st.step),
          model(st.step, draft[st.step] ?? "", d.choices.steps),
          st.backupModel ? <span title={st.backupModel}>{label(st.backupModel)}</span> : m.none,
          usedIn(u),
          u ? formatUsd(u.estimatedUsd) : "—",
          u?.winRate != null ? `${Math.round(u.winRate * 100)}%` : "—",
          onLabel(u),
        ],
      };
    }),
    {
      key: ASK_ALLY,
      cells: [
        stepName(ASK_ALLY),
        model(ASK_ALLY, draft[ASK_ALLY] ?? "", d.choices.reply),
        m.none,
        "—",
        "—",
        "—",
        s.on,
      ],
    },
    {
      key: "judge",
      cells: [
        stepName("judge"),
        <span key="j" className="text-[13px]" title={d.judge}>
          {label(d.judge)}
        </span>,
        s.neverFallsBack,
        "100%",
        "—",
        "—",
        s.fixed,
      ],
    },
  ];
  return (
    <div data-testid="steps-and-models">
      <h3 className="mb-2 text-[15px] font-semibold">{s.heading}</h3>
      <div className="overflow-x-auto rounded-sm bg-white">
        <div className={`${GRID} text-xs text-neutral-600`}>
          {[
            s.columns.step,
            s.columns.model,
            s.columns.fallback,
            s.columns.used,
            s.columns.cost,
            s.columns.win,
            s.columns.on,
          ].map(h => (
            <span key={h}>{h}</span>
          ))}
        </div>
        {rows.map(r => (
          <div key={r.key} className={`${GRID} text-sm`} data-testid="model-row">
            {r.cells.map((c, i) => (
              <span
                key={i}
                className={
                  i === 0 ? "font-medium" : i === 2 || i === 5 ? "text-[13px] text-neutral-600" : ""
                }
              >
                {c}
              </span>
            ))}
          </div>
        ))}
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-4 text-sm">
        {canEdit && (
          <>
            <Button
              kind="tertiary"
              size="md"
              disabled={!changed.length}
              onClick={() => setConfirming(true)}
            >
              {s.makeRelease}
            </Button>
            {changed.length > 0 && (
              <Button kind="ghost" size="md" onClick={() => setDraft(live)}>
                {m.reset}
              </Button>
            )}
          </>
        )}
        <span className="text-xs text-neutral-600">{s.winHelp}</span>
      </div>
      <ConfirmDialog
        isOpen={confirming}
        title={m.confirmTitle}
        cancelLabel={en.debriefs.pmAgent.cancel}
        confirmLabel={m.confirm}
        isWorking={isLoading}
        onConfirm={() => void submit()}
        onClose={() => setConfirming(false)}
      >
        <p>{m.confirmBody(changed.map(([k, v]) => m.on(stepName(k), label(v))).join(", "))}</p>
        <TextArea
          id="models-note"
          labelText={m.noteLabel}
          rows={2}
          maxCount={500}
          enableCounter
          value={note}
          onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setNote(event.target.value)}
        />
      </ConfirmDialog>
    </div>
  );
};
