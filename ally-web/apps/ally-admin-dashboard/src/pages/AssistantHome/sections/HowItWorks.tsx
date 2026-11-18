import React, { useState } from "react";

import { Link } from "react-router-dom";

import { useGetHowItWorksQuery } from "@api";
import { Segmented } from "@components/v2";
import type { HowItWorks, HowLayer } from "@types";

import { TONES, toneOf } from "../../Onboarding/MakeItYours";
import { AvoidTopics } from "../AvoidTopics";
import { HOME, fill } from "../copy";
import { SectionHead, TextField } from "../fields";
import { ListSkeleton } from "../ui/List";
import { useHomeField } from "../useHomeField";
import { joinAnd, offsetAt, purposeLimit } from "../userLists/format";

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
 * apply, each with a plain summary and, for the owner's own layers, their exact text and the
 * control to change it here. Ally's layers are summaries only: their text never leaves the server
 * (17 Nov 2026). The owner's text is the runtime's own, so it can't drift from what the assistant
 * really does.
 */
const DEFAULT_ZONE = "Asia/Kolkata";

/** Every zone the browser knows, with the assistant's own first if it isn't listed. */
const zonesWith = (current: string): string[] => {
  let zones: string[] = [];
  try {
    zones =
      (Intl as unknown as { supportedValuesOf?(k: string): string[] }).supportedValuesOf?.(
        "timeZone",
      ) ?? [];
  } catch {
    zones = [];
  }
  if (!zones.length) zones = [DEFAULT_ZONE, "Asia/Dubai", "Asia/Singapore", "Europe/London", "UTC"];
  return zones.includes(current) ? zones : [current, ...zones];
};

/** "Asia/Kolkata (UTC+05:30)". */
const zoneLabel = (zone: string): string => {
  const today = new Date().toISOString().slice(0, 10);
  return `${zone.replace(/_/g, " ")} (UTC${offsetAt(today, "12:00", zone)})`;
};

/** Where the business is (chunk 6b, item 9): a setting the owner changes here. */
const TimeZoneSelect: React.FC<{
  value: string;
  disabled: boolean;
  onChange(zone: string): void;
}> = ({ value, disabled, onChange }) => (
  <div className="ally-field" data-testid="time-zone">
    <label className="ally-field__label" htmlFor="how-time-zone">
      {t.timeZone}
    </label>
    <span className="ally-field__hint" id="how-time-zone-hint">
      {t.timeZoneHint}
    </span>
    <select
      id="how-time-zone"
      className="ally-input ally-home__select"
      value={value}
      disabled={disabled}
      aria-describedby="how-time-zone-hint"
      onChange={event => onChange(event.target.value)}
    >
      {zonesWith(value).map(zone => (
        <option key={zone} value={zone}>
          {zoneLabel(zone)}
        </option>
      ))}
    </select>
  </div>
);

export const HowItWorksSection: React.FC<SectionProps> = ({ bot, home, canEdit, go }) => {
  const { data: view, isLoading, isError, refetch } = useGetHowItWorksQuery(bot.id);
  const failed = HOME.saving.failed;
  const f = home.fields;
  const name = useHomeField(bot.id, "assistantName", f.assistantName, failed);
  const tone = useHomeField(bot.id, "tone", f.tone, failed);
  const instructions = useHomeField(bot.id, "instructions", f.instructions, failed);
  const timeZone = useHomeField(
    bot.id,
    "timeZone",
    f.timeZone ?? { value: DEFAULT_ZONE, version: "" },
    failed,
  );
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
      <>
        <TextField label={HOME.personality.name} field={name} disabled={readOnly} maxLength={60} />
        <TimeZoneSelect
          value={timeZone.value}
          disabled={readOnly}
          onChange={zone => timeZone.set(zone, { now: true })}
        />
      </>
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
  // What it can do with each list, under How it finds answers.
  const tools = (view.tools ?? []).filter(tool => tool.can.length);
  if (tools.length) {
    controls.search = (
      <ul className="ally-small ally-how__tools" data-testid="how-tools">
        {tools.map(tool => (
          <li key={tool.list}>
            {fill(t.tools.line, {
              list: tool.list,
              can: joinAnd(tool.can.map(kind => t.tools[kind])),
            })}
          </li>
        ))}
      </ul>
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

      {/* Memory's controls live in Tools now (chunk 8a); a pointer stays here. */}
      {home.fields.memory && (
        <p className="ally-small ally-how__moved" data-testid="how-memory-moved">
          {HOME.memory.movedToTools}{" "}
          <Link to={{ search: "?section=lists&tool=memory" }}>{HOME.memory.openTools}</Link>
        </p>
      )}
    </>
  );
};
