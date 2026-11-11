import React, { useMemo, useState } from "react";

import { toast } from "sonner";

import { Button, CarbonDropdown as Dropdown, TextArea } from "@ally-ui-mono/ui-shared";
import { useGetDebriefModelsQuery, useSetDebriefModelsMutation } from "@api";
import { ConfirmDialog } from "@components/ally-guide/ConfirmDialog";
import { ErrorPanel, LoadingBlock } from "@components/ally-guide/ConsoleStates";
import { en } from "@constants";
import { DebriefModelChoice } from "@types";
import { getErrorMessage } from "@utils";

import { modelLabels, stepName } from "./consoleLabels";
import { ConsoleTable } from "./consoleTable";

const ASK_ALLY = "ask_ally";

/** A model id shown by its catalog name, with the id itself on hover. */
const ModelName: React.FC<{ id: string; label: (id: string) => string }> = ({ id, label }) => (
  <span title={id}>{label(id)}</span>
);

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
    <div className="w-full min-w-[14rem] max-w-xs">
      <Dropdown
        id={id}
        size="sm"
        titleText={label}
        hideLabel
        label={label}
        items={options}
        selectedItem={options.find(c => c.model === value) ?? null}
        itemToString={(c: DebriefModelChoice | null) => c?.label ?? ""}
        itemToElement={(c: DebriefModelChoice | null) =>
          c ? <span title={c.model}>{c.label}</span> : null
        }
        onChange={({ selectedItem }: { selectedItem: DebriefModelChoice | null }) =>
          selectedItem && onChange(selectedItem.model)
        }
      />
    </div>
  );
};

/**
 * Pick the model each debrief step runs on. A change becomes a new release,
 * checked by the same rules as every release, and Roll back undoes it.
 */
export const ModelsPanel: React.FC = () => {
  const s = en.debriefs.releases.models;
  const models = useGetDebriefModelsQuery();
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
  // The draft starts from the live release and starts again whenever that changes (a save,
  // a rollback); adjusted while rendering rather than in an effect.
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
      toast.success(s.saved(r.version));
      setConfirming(false);
      setNote("");
    } catch (e) {
      toast.error(getErrorMessage(e, s.failed));
    }
  };

  if (models.isError) {
    return (
      <ErrorPanel what={s.loadFailed} error={models.error} onRetry={() => void models.refetch()} />
    );
  }
  if (!models.data) return <LoadingBlock lines={4} />;
  const d = models.data;

  return (
    <section className="flex flex-col gap-3" data-testid="models-panel">
      <div>
        <h3 className="text-xl font-normal text-typography-900">{s.heading}</h3>
        <p className="max-w-3xl pt-1 text-sm text-typography-700">{s.help}</p>
        <p className="max-w-3xl pt-1 text-xs text-typography-700">{s.anthropicNote}</p>
      </div>
      <ConsoleTable
        testId="models-table"
        headers={[s.columns.step, s.columns.model, s.columns.backup]}
        rows={[
          ...d.steps.map(st => ({
            key: st.step,
            testId: "model-row",
            cells: [
              stepName(st.step),
              <ModelSelect
                key="m"
                id={`model-${st.step}`}
                label={stepName(st.step)}
                value={draft[st.step] ?? ""}
                choices={d.choices.steps}
                onChange={m => setDraft({ ...draft, [st.step]: m })}
              />,
              st.backupModel ? <ModelName key="b" id={st.backupModel} label={label} /> : s.none,
            ],
          })),
          {
            key: ASK_ALLY,
            testId: "model-row",
            cells: [
              stepName(ASK_ALLY),
              <ModelSelect
                key="m"
                id="model-ask-ally"
                label={stepName(ASK_ALLY)}
                value={draft[ASK_ALLY] ?? ""}
                choices={d.choices.reply}
                onChange={m => setDraft({ ...draft, [ASK_ALLY]: m })}
              />,
              s.none,
            ],
          },
          {
            key: "judge",
            testId: "model-row",
            cells: [
              stepName("judge"),
              <span key="j">
                <ModelName id={d.judge} label={label} /> · {s.fixed}
              </span>,
              s.none,
            ],
          },
        ]}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          kind="primary"
          size="sm"
          disabled={!changed.length}
          onClick={() => setConfirming(true)}
        >
          {s.save}
        </Button>
        <Button kind="tertiary" size="sm" disabled={!changed.length} onClick={() => setDraft(live)}>
          {s.reset}
        </Button>
      </div>
      <ConfirmDialog
        isOpen={confirming}
        title={s.confirmTitle}
        cancelLabel={en.debriefs.pmAgent.cancel}
        confirmLabel={s.confirm}
        isWorking={isLoading}
        onConfirm={() => void submit()}
        onClose={() => setConfirming(false)}
      >
        <p>{s.confirmBody(changed.map(([k, v]) => s.on(stepName(k), label(v))).join(", "))}</p>
        <TextArea
          id="models-note"
          labelText={s.noteLabel}
          rows={2}
          maxCount={500}
          enableCounter
          value={note}
          onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setNote(event.target.value)}
        />
      </ConfirmDialog>
    </section>
  );
};
