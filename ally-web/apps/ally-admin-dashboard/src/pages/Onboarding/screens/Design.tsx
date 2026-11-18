import React, { useState } from "react";

import { AssistantLine, DesignCard as DesignCardView, PrimaryButton } from "@components/v2";

import { COPY } from "../copy";

import type { DesignCard } from "../types";

// ── Choose a design ───────────────────────────────────────────────────────

/**
 * What should your assistant do? (chunk 20a-2): the five purpose cards, the recommended one first
 * and badged; "Something else" asks for a sentence. A draft offered the older designs still shows
 * them, with Coming soon.
 */
export const DesignScreen: React.FC<{
  designs: DesignCard[];
  chosen: string | null;
  canChoose: boolean;
  line?: string;
  onChoose: (id: string) => void;
  /** "Something else": the owner's sentence about what it's for. */
  onDescribe?: (text: string) => void;
}> = ({ designs, chosen, canChoose, line, onChoose, onDescribe }) => (
  <>
    {line && <AssistantLine>{line}</AssistantLine>}
    <h1 className="ally-heading">{COPY.purposes.title}</h1>
    {chosen === "custom" && canChoose && onDescribe && <DescribePurpose onDescribe={onDescribe} />}
    <div className="ally-designs">
      {designs.map((design, i) =>
        design.coming_soon ? (
          <DesignCardView
            key={design.id}
            index={i}
            title={COPY.designs.comingSoonTitle}
            body={COPY.designs.comingSoonBody}
            comingSoon
            labels={{ ...COPY.designs, comingSoon: COPY.designs.comingSoonBadge }}
          />
        ) : (
          <DesignCardView
            key={design.id}
            index={i}
            title={design.title}
            bestFor={design.best_for}
            will={design.will}
            wont={design.wont}
            sample={design.sample}
            chosen={chosen === design.id}
            canChoose={canChoose}
            recommended={design.recommended}
            limit={design.limit}
            labels={{
              ...COPY.designs,
              comingSoon: COPY.designs.comingSoonBadge,
              recommended: COPY.purposes.recommended,
            }}
            onChoose={() => onChoose(design.id)}
          />
        ),
      )}
    </div>
  </>
);

const DescribePurpose: React.FC<{ onDescribe: (text: string) => void }> = ({ onDescribe }) => {
  const [text, setText] = useState("");
  return (
    <form
      className="ally-field"
      data-testid="describe-purpose"
      onSubmit={event => {
        event.preventDefault();
        if (text.trim()) onDescribe(text.trim());
      }}
    >
      <label className="ally-field__label" htmlFor="purpose-note">
        {COPY.purposes.customPrompt}
      </label>
      <textarea
        id="purpose-note"
        className="ally-input"
        maxLength={600}
        value={text}
        onChange={event => setText(event.target.value)}
      />
      <div className="ally-btn-row">
        <PrimaryButton type="submit" disabled={!text.trim()}>
          {COPY.gaps.ok}
        </PrimaryButton>
      </div>
    </form>
  );
};
