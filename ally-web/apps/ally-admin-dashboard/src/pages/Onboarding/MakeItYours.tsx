import React, { useState } from "react";

import { PrimaryButton, Question, Segmented, useEnterToSubmit } from "@components/v2";

import { COPY } from "./copy";

import type { BotDraftView, PatchOp } from "./types";

/** The deck's three tones (copy §16) and the draft's tone values they set. */
export const TONES = [
  { id: "warm", label: COPY.make.tones.warm, value: "warm" },
  { id: "balanced", label: COPY.make.tones.balanced, value: "professional" },
  { id: "formal", label: COPY.make.tones.formal, value: "formal" },
] as const;
export type ToneId = (typeof TONES)[number]["id"];

export const toneOf = (value: string): ToneId =>
  TONES.find(t => t.value === value)?.id ?? (value === "friendly" ? "warm" : "balanced");

/**
 * "Make it yours" (chunk 20d §2): the built assistant's name, tone and opening line, each saved as
 * a draft patch as the owner leaves the field. Presentation over `useOnboardingSession.edit`.
 */
export const MakeItYoursScreen: React.FC<{
  view: BotDraftView;
  onPatch: (target: "draft", ops: PatchOp[]) => Promise<boolean>;
  onContinue: () => void;
  /** The logo, cover and colour controls and the phone preview (added by the brand work). */
  brand?: React.ReactNode;
  preview?: React.ReactNode;
}> = ({ view, onPatch, onContinue, brand, preview }) => {
  const draft = view.draft;
  const [name, setName] = useState(draft.assistantName);
  const [opening, setOpening] = useState(draft.introduction);
  const [tone, setTone] = useState<ToneId>(toneOf(draft.tone));
  useEnterToSubmit(onContinue);

  const save = (path: string, value: string, current: string) => {
    const next = value.trim();
    if (next && next !== current) void onPatch("draft", [{ op: "replace", path, value: next }]);
  };

  return (
    <div className="ally-make">
      <div className="ally-make__controls">
        <Question title={COPY.make.title} subtitle={COPY.make.subtitle} />
        <div className="ally-field">
          <label htmlFor="make-name">{COPY.make.name}</label>
          <input
            id="make-name"
            className="ally-input"
            value={name}
            maxLength={60}
            onChange={event => setName(event.target.value)}
            onBlur={() => save("/assistantName", name, draft.assistantName)}
          />
        </div>
        {brand}
        <div className="ally-field">
          <span className="ally-field__label" id="make-tone">
            {COPY.make.tone}
          </span>
          <Segmented
            label={COPY.make.tone}
            value={tone}
            options={TONES.map(t => ({ id: t.id, label: t.label }))}
            onChange={id => {
              setTone(id);
              const value = TONES.find(t => t.id === id)!.value;
              if (value !== draft.tone)
                void onPatch("draft", [{ op: "replace", path: "/tone", value }]);
            }}
          />
        </div>
        <div className="ally-field">
          <label htmlFor="make-opening">{COPY.make.opening}</label>
          <textarea
            id="make-opening"
            className="ally-input"
            value={opening}
            maxLength={600}
            onChange={event => setOpening(event.target.value)}
            onBlur={() => save("/introduction", opening, draft.introduction)}
          />
        </div>
        <PrimaryButton enterHint={COPY.frame.enterHint} onClick={onContinue}>
          {COPY.make.continue}
        </PrimaryButton>
      </div>
      {preview && <div className="ally-make__preview">{preview}</div>}
    </div>
  );
};
