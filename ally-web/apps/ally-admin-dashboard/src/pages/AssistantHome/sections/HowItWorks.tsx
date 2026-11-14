import React, { useState } from "react";

import { useGetHowItWorksQuery } from "@api";
import { Segmented } from "@components/v2";
import type { HowItWorks, HowLayer } from "@types";

import { TONES, toneOf } from "../../Onboarding/MakeItYours";
import { AvoidTopics } from "../AvoidTopics";
import { HOME, fill } from "../copy";
import { Group, SectionHead, TextField } from "../fields";
import { ListSkeleton } from "../ui/List";
import { useHomeField } from "../useHomeField";
import { purposeLimit } from "../userLists/format";

import type { SectionId } from "../sections";
import type { SectionProps } from "./props";

const t = HOME.how;

/** The layers in the order they apply, as the brief's table lists them. */
const ORDER: HowLayer[] = [
  "base",
  "safety",
  "purpose",
  "business",
  "tone",
  "instructions",
  "avoid",
  "search",
];

/** Where a layer that isn't edited here is edited. */
const EDITED_IN: Partial<Record<HowLayer, SectionId>> = {
  safety: "safety",
  search: "knows",
};

/** The owner's instructions' limit (ally-be `MAX_SYSTEM_PROMPT_CHARS`). */
const MAX_INSTRUCTIONS = 4000;

const textOf = (view: HowItWorks, layer: HowLayer) =>
  view.parts
    .filter(p => p.layer === layer)
    .map(p => p.text)
    .join("")
    .trim();

/** One layer: what it is in plain words, its exact text on request, and the owner's control. */
const Layer: React.FC<{
  layer: HowLayer;
  n: number;
  view: HowItWorks;
  summary: string;
  owner: boolean;
  control?: React.ReactNode;
  go?: () => void;
}> = ({ layer, n, view, summary, owner, control, go }) => {
  const [open, setOpen] = useState(false);
  const exact = textOf(view, layer);
  const sectionName = EDITED_IN[layer] ? HOME.sections[EDITED_IN[layer]!] : null;
  return (
    <li className="ally-card ally-how__layer" id={`how-${layer}`} data-testid={`how-${layer}`}>
      <header className="ally-how__head">
        <span className="ally-how__n" aria-hidden="true">
          {n}
        </span>
        <h3 className="ally-home__group-title">{t.layers[layer].title}</h3>
        <span className={`ally-badge ${owner ? "ally-badge--good" : "ally-badge--muted"}`}>
          {owner ? t.yours : t.byAlly}
        </span>
      </header>
      <p className="ally-small">{summary}</p>
      {!owner && layer !== "search" && <p className="ally-small ally-how__locked">{t.locked}</p>}
      {control}
      <div className="ally-btn-row">
        {exact && (
          <button
            type="button"
            className="ally-link ally-small"
            aria-expanded={open}
            onClick={() => setOpen(o => !o)}
          >
            {open ? t.hideText : t.showText}
          </button>
        )}
        {go && sectionName && (
          <button type="button" className="ally-link ally-small" onClick={go}>
            {fill(t.editIn, { section: sectionName })}
          </button>
        )}
      </div>
      {open && exact && <pre className="ally-how__text">{exact}</pre>}
    </li>
  );
};

/**
 * How it works (chunk 20d-2): everything the assistant follows, as layers in the order they
 * apply, each with a plain summary, its exact text, and, for the owner's own layers, the control
 * to change it here. The text is the runtime's own (ally-be asks ally-ai to build it from the
 * request a run sends), so it can't drift from what the assistant really does.
 */
export const HowItWorksSection: React.FC<SectionProps> = ({ bot, home, canEdit, go }) => {
  const { data: view, isLoading, isError, refetch } = useGetHowItWorksQuery(bot.id);
  const failed = HOME.saving.failed;
  const f = home.fields;
  const name = useHomeField(bot.id, "assistantName", f.assistantName, failed);
  const tone = useHomeField(bot.id, "tone", f.tone, failed);
  const instructions = useHomeField(bot.id, "instructions", f.instructions, failed);
  const [full, setFull] = useState(false);
  const readOnly = !canEdit;

  const head = <SectionHead title={HOME.sections.how} subtitle={t.intro} help={HOME.help.how} />;
  if (isLoading) {
    return (
      <>
        {head}
        <ListSkeleton rows={6} />
      </>
    );
  }
  if (isError || !view) {
    return (
      <>
        {head}
        <p className="ally-note ally-note--warn" role="alert">
          {t.unavailable}{" "}
          <button type="button" className="ally-link" onClick={() => void refetch()}>
            {HOME.lists.retry}
          </button>
        </p>
      </>
    );
  }

  const pack = home.safety.pack?.industryLabel ?? t.packAny;
  const purpose = view.purpose ?? t.purposeNone;
  const summaries: Record<HowLayer, string> = {
    base: t.layers.base.summary,
    safety: fill(t.layers.safety.summary, { pack }),
    purpose: fill(t.layers.purpose.summary, { purpose }),
    business: t.layers.business.summary,
    tone: t.layers.tone.summary,
    instructions: t.layers.instructions.summary,
    avoid: t.layers.avoid.summary,
    search: fill(t.layers.search.summary, {
      searches: view.search.searches,
      passages: view.search.max_passages,
      documents: view.search.documents,
    }),
  };
  const controls: Partial<Record<HowLayer, React.ReactNode>> = {
    business: (
      <TextField label={HOME.personality.name} field={name} disabled={readOnly} maxLength={60} />
    ),
    tone: readOnly ? (
      <p className="ally-body">{TONES.find(x => x.id === toneOf(tone.value))?.label}</p>
    ) : (
      <Segmented
        label={HOME.personality.tone}
        options={TONES.map(x => ({ id: x.id, label: x.label }))}
        value={toneOf(tone.value)}
        onChange={id => tone.set(TONES.find(x => x.id === id)!.value, { now: true })}
      />
    ),
    instructions: (
      <>
        <TextField
          label={t.instructionsLabel}
          field={instructions}
          disabled={readOnly}
          multiline
          rows={6}
          maxLength={MAX_INSTRUCTIONS}
        />
        <p className="ally-small ally-how__counter" aria-live="polite">
          {fill(t.counter, { n: instructions.value.length, max: MAX_INSTRUCTIONS })}
        </p>
        {instructions.notice && (
          <p className="ally-note" role="status">
            {instructions.notice}
          </p>
        )}
      </>
    ),
    avoid: canEdit ? <AvoidTopics botId={bot.id} /> : undefined,
  };
  // The purpose's honest limit, with what the assistant may do on its lists now (chunk 5b).
  const limit = purposeLimit(view.purpose, view.bookingLists);
  if (limit) {
    controls.purpose = (
      <p className="ally-small ally-how__limit" data-testid="purpose-limit">
        <strong>{HOME.userLists.purpose.limitLabel}:</strong> {limit}
      </p>
    );
  }
  // A purpose only appears when one was chosen; the others always apply.
  const shown = ORDER.filter(layer => layer !== "purpose" || textOf(view, "purpose"));

  return (
    <>
      {head}
      <ol className="ally-how" data-testid="how-it-works">
        {shown.map((layer, index) => (
          <Layer
            key={layer}
            layer={layer}
            n={index + 1}
            view={view}
            summary={summaries[layer]}
            owner={["business", "tone", "instructions", "avoid"].includes(layer)}
            control={controls[layer]}
            go={EDITED_IN[layer] ? () => go(EDITED_IN[layer]!) : undefined}
          />
        ))}
      </ol>

      <Group>
        <button
          type="button"
          className="ally-link"
          aria-expanded={full}
          onClick={() => setFull(v => !v)}
        >
          {full ? t.hideFull : t.showFull}
        </button>
        {full && (
          <>
            <p className="ally-small">
              {fill(t.fullHint, { question: view.placeholders.question })}
            </p>
            <pre className="ally-how__text ally-how__full" data-testid="how-full">
              {view.parts.map((part, index) =>
                part.owner ? (
                  <mark key={index} className="ally-how__mine">
                    {part.text}
                    {canEdit && (
                      <button
                        type="button"
                        className="ally-how__edit"
                        onClick={() =>
                          document
                            .getElementById(`how-${part.layer}`)
                            ?.querySelector<HTMLElement>("input, textarea, button")
                            ?.focus()
                        }
                      >
                        {t.editHere}
                      </button>
                    )}
                  </mark>
                ) : (
                  <React.Fragment key={index}>{part.text}</React.Fragment>
                ),
              )}
            </pre>
          </>
        )}
      </Group>
    </>
  );
};
