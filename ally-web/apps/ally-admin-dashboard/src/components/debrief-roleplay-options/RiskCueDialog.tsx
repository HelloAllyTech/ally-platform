import React, { useMemo, useState } from "react";

import { toast } from "sonner";

import {
  Button,
  CarbonToggle,
  ComposedModal,
  ModalBody,
  TextArea,
  TextInput,
} from "@ally-ui-mono/ui-shared";
import {
  useCreateRiskCueOptionMutation,
  useGetRiskCueOptionsQuery,
  useSubmitRiskCueOptionMutation,
  useTestRiskCueOptionMutation,
  useUpdateRiskCueOptionMutation,
} from "@api";
import { en } from "@constants";
import { RiskCueHandling, RiskCueOption, RiskCueOptionInput } from "@types";

import { riskCueErrorMessage } from "./riskCueErrors";
import { RiskCueTestView } from "./RiskCueTestView";

export const MIN_WORDING = 60;
export const MAX_EXAMPLES = 12;

export interface RiskCueFormState {
  name: string;
  wording: string;
  handling: RiskCueHandling;
  wordListRaises: boolean;
  supportLinesOnCue: boolean;
  cues: string;
  nonCues: string;
}

const EMPTY: RiskCueFormState = {
  name: "",
  wording: "",
  handling: "alarm",
  wordListRaises: true,
  supportLinesOnCue: true,
  cues: "",
  nonCues: "",
};

const lines = (text: string) =>
  text
    .split("\n")
    .map(l => l.trim())
    .filter(Boolean);

const fromOption = (o: RiskCueOption): RiskCueFormState => ({
  name: o.name,
  wording: o.wording ?? "",
  handling: o.handling,
  wordListRaises: o.wordListRaises,
  supportLinesOnCue: o.supportLinesOnCue,
  cues: o.examples.cues.join("\n"),
  nonCues: o.examples.nonCues.join("\n"),
});

/** The request body for a form. */
export const toRiskCuePayload = (f: RiskCueFormState): RiskCueOptionInput => ({
  name: f.name.trim(),
  wording: f.wording.trim(),
  handling: f.handling,
  wordListRaises: f.wordListRaises,
  supportLinesOnCue: f.supportLinesOnCue,
  examples: { cues: lines(f.cues), nonCues: lines(f.nonCues) },
});

/** What is wrong with the form, in plain words (empty when it can be saved). */
export const riskCueProblems = (
  f: RiskCueFormState,
): Partial<Record<keyof RiskCueFormState, string>> => {
  const d = en.debriefRoleplayOptions.dialog;
  const out: Partial<Record<keyof RiskCueFormState, string>> = {};
  if (!f.name.trim()) out.name = d.nameRequired;
  if (f.wording.trim().length < MIN_WORDING) out.wording = d.wordingMin;
  const cues = lines(f.cues).length;
  const non = lines(f.nonCues).length;
  if (cues < 1) out.cues = d.cuesMin;
  else if (cues > MAX_EXAMPLES) out.cues = d.examplesMax;
  if (non < 1) out.nonCues = d.cuesMin;
  else if (non > MAX_EXAMPLES) out.nonCues = d.examplesMax;
  return out;
};

/**
 * Write a risk-cue option, or open one of your own drafts: save it, test it (takes up to a
 * minute), then send it for a clinical advisor's approval once a test has passed on this version.
 */
export const RiskCueDialog: React.FC<{ optionId: string | null; onClose: () => void }> = ({
  optionId,
  onClose,
}) => {
  const s = en.debriefRoleplayOptions.dialog;
  const q = useGetRiskCueOptionsQuery();
  const [create, creating] = useCreateRiskCueOptionMutation();
  const [update, updating] = useUpdateRiskCueOptionMutation();
  const [runTest, testing] = useTestRiskCueOptionMutation();
  const [send, sending] = useSubmitRiskCueOptionMutation();
  const [savedId, setSavedId] = useState<string | null>(optionId);
  // The create reply stands in until the list has refetched, so a second click can't make a twin.
  const [created, setCreated] = useState<RiskCueOption | null>(null);
  const current = (q.data ?? []).find(o => o.id === savedId) ?? (savedId ? created : null);
  const [form, setForm] = useState<RiskCueFormState>(() => {
    const o = optionId ? (q.data ?? []).find(x => x.id === optionId) : null;
    return o ? fromOption(o) : EMPTY;
  });
  const [tried, setTried] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const problems = riskCueProblems(form);
  const set = <K extends keyof RiskCueFormState>(k: K, v: RiskCueFormState[K]) =>
    setForm(f => ({ ...f, [k]: v }));

  const dirty = useMemo(
    () =>
      current
        ? JSON.stringify(toRiskCuePayload(form)) !==
          JSON.stringify(toRiskCuePayload(fromOption(current)))
        : true,
    [current, form],
  );
  const working =
    creating.isLoading || updating.isLoading || testing.isLoading || sending.isLoading;
  const test = current?.testResult ?? null;
  const testIsCurrent = !!test && !!current && test.version === current.version;
  const canSend =
    !!current &&
    current.status === "draft" &&
    !dirty &&
    testIsCurrent &&
    test?.passed === true &&
    !working;

  const save = async () => {
    setTried(true);
    setError(null);
    if (Object.keys(problems).length > 0) return;
    try {
      if (current) {
        await update({ id: current.id, changes: toRiskCuePayload(form) }).unwrap();
      } else {
        const made = await create(toRiskCuePayload(form)).unwrap();
        setCreated(made);
        setSavedId(made.id);
      }
      toast.success(s.saved);
    } catch (e) {
      setError(riskCueErrorMessage(e, s.saveFailed));
    }
  };
  const doTest = async () => {
    if (!current) return;
    setError(null);
    try {
      await runTest(current.id).unwrap();
    } catch (e) {
      setError(riskCueErrorMessage(e, s.testFailed));
    }
  };
  const doSend = async () => {
    if (!current) return;
    setError(null);
    try {
      await send(current.id).unwrap();
      toast.success(s.sent);
      onClose();
    } catch (e) {
      setError(riskCueErrorMessage(e, s.sendFailed));
    }
  };
  const shown = (k: keyof RiskCueFormState) => (tried ? problems[k] : undefined);

  return (
    <ComposedModal open onClose={onClose} size="md" aria-label={current ? s.titleEdit : s.titleNew}>
      <ModalBody>
        <div className="flex flex-col gap-4" data-testid="risk-cue-dialog">
          <h2 className="text-lg font-semibold text-typography-900">
            {current ? s.titleEdit : s.titleNew}
          </h2>
          {current?.reviewNote && current.status === "draft" && (
            <p className="text-sm text-destructive-500" data-testid="risk-cue-review-note">
              {s.turnedDown(current.reviewNote)}
            </p>
          )}
          <TextInput
            id="risk-cue-name"
            labelText={s.name}
            value={form.name}
            maxLength={80}
            invalid={!!shown("name")}
            invalidText={shown("name")}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => set("name", e.target.value)}
          />
          <TextArea
            id="risk-cue-wording"
            labelText={s.wording}
            rows={4}
            value={form.wording}
            invalid={!!shown("wording")}
            invalidText={shown("wording")}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => set("wording", e.target.value)}
          />
          <fieldset className="flex flex-col gap-1">
            <legend className="pb-1 text-sm text-typography-700">{s.handling}</legend>
            {(["alarm", "assessed"] as const).map(h => (
              <label key={h} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="risk-cue-handling"
                  checked={form.handling === h}
                  onChange={() => set("handling", h)}
                />
                {s[h]}
              </label>
            ))}
          </fieldset>
          <CarbonToggle
            id="risk-cue-word-list"
            size="sm"
            labelText={s.wordListRaises}
            labelA=""
            labelB=""
            toggled={form.wordListRaises}
            onToggle={(on: boolean) => set("wordListRaises", on)}
          />
          <CarbonToggle
            id="risk-cue-support"
            size="sm"
            labelText={s.supportLines}
            labelA=""
            labelB=""
            toggled={form.supportLinesOnCue}
            onToggle={(on: boolean) => set("supportLinesOnCue", on)}
          />
          <TextArea
            id="risk-cue-cues"
            labelText={s.cues}
            helperText={s.examplesHint}
            rows={4}
            value={form.cues}
            invalid={!!shown("cues")}
            invalidText={shown("cues")}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => set("cues", e.target.value)}
          />
          <TextArea
            id="risk-cue-non-cues"
            labelText={s.nonCues}
            rows={4}
            value={form.nonCues}
            invalid={!!shown("nonCues")}
            invalidText={shown("nonCues")}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => set("nonCues", e.target.value)}
          />
          {testing.isLoading && (
            <p className="text-sm text-typography-700" role="status" data-testid="risk-cue-testing">
              {s.testing}
            </p>
          )}
          {!testing.isLoading && test && (
            <>
              <RiskCueTestView
                result={test}
                passedText={s.testPassed}
                failedText={s.testNotPassed}
              />
              {!testIsCurrent && <p className="text-[13px] text-typography-600">{s.staleTest}</p>}
            </>
          )}
          {error && (
            <p className="text-sm text-destructive-500" role="alert" data-testid="risk-cue-error">
              {error}
            </p>
          )}
          <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
            <Button kind="ghost" onClick={onClose}>
              {s.close}
            </Button>
            {current && (
              <Button kind="tertiary" disabled={working || dirty} onClick={() => void doTest()}>
                {s.testIt}
              </Button>
            )}
            {current && current.status === "draft" && (
              <Button kind="tertiary" disabled={!canSend} onClick={() => void doSend()}>
                {s.send}
              </Button>
            )}
            <Button kind="primary" disabled={working} onClick={() => void save()}>
              {current ? s.save : s.saveDraft}
            </Button>
          </div>
          {current && current.status === "draft" && !canSend && !working && (
            <p className="text-[13px] text-typography-600">{dirty ? s.saveFirst : s.needsTest}</p>
          )}
        </div>
      </ModalBody>
    </ComposedModal>
  );
};
