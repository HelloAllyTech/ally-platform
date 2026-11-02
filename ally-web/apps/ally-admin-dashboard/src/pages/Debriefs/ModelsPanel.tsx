import React, { useEffect, useMemo, useState } from "react";

import { toast } from "sonner";

import { Button, Select, SelectItem, TextArea } from "@ally-ui-mono/ui-shared";
import { useGetDebriefModelsQuery, useSetDebriefModelsMutation } from "@api";
import { ConfirmDialog } from "@components/ally-guide/ConfirmDialog";
import { ErrorPanel, LoadingBlock } from "@components/ally-guide/ConsoleStates";
import { en } from "@constants";
import { DebriefModelChoice } from "@types";
import { getErrorMessage } from "@utils";

import { ConsoleTable } from "./consoleTable";

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
    <Select
      id={id}
      labelText={label}
      hideLabel
      size="sm"
      value={value}
      onChange={(event: React.ChangeEvent<HTMLSelectElement>) => onChange(event.target.value)}
    >
      {options.map(c => (
        <SelectItem key={c.model} value={c.model} text={`${c.label} (${c.model})`} />
      ))}
    </Select>
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
  const [draft, setDraft] = useState<Record<string, string>>({});
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
  useEffect(() => setDraft(live), [live]);

  const changed = Object.entries(draft).filter(([k, v]) => v && v !== live[k]);

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
              s.steps[st.step] ?? st.step,
              <ModelSelect
                key="m"
                id={`model-${st.step}`}
                label={s.steps[st.step] ?? st.step}
                value={draft[st.step] ?? ""}
                choices={d.choices.steps}
                onChange={m => setDraft({ ...draft, [st.step]: m })}
              />,
              st.backupModel ?? s.none,
            ],
          })),
          {
            key: ASK_ALLY,
            testId: "model-row",
            cells: [
              s.steps[ASK_ALLY],
              <ModelSelect
                key="m"
                id="model-ask-ally"
                label={s.steps[ASK_ALLY]}
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
            cells: [s.steps.judge, `${d.judge} · ${s.fixed}`, s.none],
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
        cancelLabel={en.debriefs.improver.cancel}
        confirmLabel={s.confirm}
        isWorking={isLoading}
        onConfirm={() => void submit()}
        onClose={() => setConfirming(false)}
      >
        <p>{s.confirmBody(changed.map(([k, v]) => `${s.steps[k] ?? k} on ${v}`).join(", "))}</p>
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
