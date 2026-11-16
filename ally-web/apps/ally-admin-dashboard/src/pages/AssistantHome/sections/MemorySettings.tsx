import React from "react";

import { Switch } from "@components/v2";
import type { AssistantHomeView, MemorySettings as Settings } from "@types";

import { HOME, fill } from "../copy";
import { LinesField } from "../fields";
import { useHomeField, type HomeField } from "../useHomeField";

const t = HOME.memory;

/** The owner's own never-store lines, as a list field over the memory setting. */
const ownLines = (field: HomeField<Settings>): HomeField<string[]> => ({
  ...field,
  value: field.value.neverStore,
  set: (neverStore, options) => field.set({ ...field.value, neverStore }, options),
});

/**
 * Remember people between chats (chunk 8a), in How it works: off by default. Below the switch, what
 * it never remembers: the defaults (every bot's, and the safety pack's) can't be removed, since
 * safety only tightens; the owner can add up to 20 of their own.
 */
export const MemorySettings: React.FC<{
  botId: string;
  home: AssistantHomeView;
  canEdit: boolean;
}> = props =>
  // An ally-be from before 8a doesn't send the field: then there's nothing to switch.
  props.home.fields.memory ? <MemoryCard {...props} /> : null;

const MemoryCard: React.FC<{
  botId: string;
  home: AssistantHomeView;
  canEdit: boolean;
}> = ({ botId, home, canEdit }) => {
  const memory = useHomeField(botId, "memory", home.fields.memory, HOME.saving.failed);
  const own = ownLines(memory);
  return (
    <section className="ally-card ally-how__memory" id="how-memory" data-testid="how-memory">
      <Switch
        label={t.switchLabel}
        hint={t.switchHint}
        checked={memory.value.on}
        disabled={!canEdit}
        onChange={on => memory.set({ ...memory.value, on }, { now: true })}
      />
      {memory.error && (
        <p className="ally-note ally-note--warn" role="alert">
          {memory.error}
        </p>
      )}
      <h3 className="ally-home__group-title">{t.neverLabel}</h3>
      <div>
        <ul className="ally-how__never" aria-label={t.alwaysOn}>
          {memory.value.defaults.map(item => (
            <li key={item} className="ally-badge ally-badge--muted">
              {item}
            </li>
          ))}
        </ul>
        <p className="ally-small ally-how__never-note">{t.alwaysOn}</p>
      </div>
      <LinesField
        label={t.addHint}
        hint={t.upTo}
        addLabel={t.add}
        removeLabel={fill(t.remove, { item: "" }).trim()}
        field={own}
        max={20}
        maxLength={80}
        disabled={!canEdit}
      />
    </section>
  );
};
