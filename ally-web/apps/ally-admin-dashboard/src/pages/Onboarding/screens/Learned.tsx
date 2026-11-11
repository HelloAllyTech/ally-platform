import React from "react";

import {
  LearnedCard as LearnedRow,
  PrimaryButton,
  Question,
  useEnterToSubmit,
} from "@components/v2";

import { COPY } from "../copy";

import type { BotDraftView, LearnedFact, LearnedSection, PatchOp } from "../types";

// ── 3. What we learned ────────────────────────────────────────────────────

const SECTIONS = Object.keys(COPY.learned.sections) as LearnedSection[];

const sourceLabel = (fact: LearnedFact) => {
  if (fact.byOwner || fact.sourceUrl === "owner") return COPY.learned.fromYou;
  return fact.sourceTitle || fact.sourceUrl;
};
const sourceHref = (fact: LearnedFact) =>
  /^https?:\/\//.test(fact.sourceUrl) ? fact.sourceUrl : null;

export const LearnedScreen: React.FC<{
  view: BotDraftView;
  busy: boolean;
  onPatch: (target: "learned", ops: PatchOp[]) => Promise<boolean>;
  onConfirm: () => void;
}> = ({ view, busy, onPatch, onConfirm }) => {
  const facts = view.learned.facts;
  const canConfirm = view.step === "learned";
  useEnterToSubmit(onConfirm, canConfirm && !busy);
  return (
    <>
      <Question title={COPY.learned.title} subtitle={COPY.learned.subtitle} />
      {SECTIONS.map(section => {
        const inSection = facts
          .map((fact, index) => ({ fact, index }))
          .filter(({ fact }) => fact.section === section);
        return (
          <section key={section} className="ally-learned-group">
            <h2 className="ally-label" style={{ margin: 0 }}>
              {COPY.learned.sections[section]}
            </h2>
            {inSection.length === 0 ? (
              <p className="ally-empty">{COPY.learned.empty}</p>
            ) : (
              <ul
                className="ally-learned-group"
                style={{ listStyle: "none", margin: 0, padding: 0 }}
              >
                {inSection.map(({ fact, index }, i) => (
                  <LearnedRow
                    key={fact.id}
                    index={i}
                    text={fact.text}
                    source={{ label: sourceLabel(fact), href: sourceHref(fact) }}
                    labels={COPY.learned}
                    busy={busy}
                    onSave={text =>
                      onPatch("learned", [
                        { op: "replace", path: `/facts/${index}/text`, value: text },
                      ])
                    }
                    onRemove={() =>
                      void onPatch("learned", [{ op: "remove", path: `/facts/${index}` }])
                    }
                  />
                ))}
              </ul>
            )}
          </section>
        );
      })}
      {canConfirm && (
        <PrimaryButton enterHint={COPY.frame.enterHint} onClick={onConfirm} disabled={busy}>
          {COPY.learned.confirm}
        </PrimaryButton>
      )}
    </>
  );
};
