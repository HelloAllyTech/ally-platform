import React, { useEffect, useMemo, useRef, useState } from "react";

import { useAskBuilderAllWorkMutation } from "@api";
import { en } from "@constants";
import { BuilderAskAnswer } from "@types";

const strings = en.builder.room.palette;

export interface PaletteItem {
  id: string;
  label: string;
  kind: string;
  disabled?: boolean;
  disabledLabel?: string;
  run: () => void;
}

interface CommandPaletteProps {
  items: PaletteItem[];
  fullScreen: boolean;
  onFind: (q: string) => void;
  onClose: () => void;
}

/**
 * ⌘K, or ⌕ on a phone: the one door to everything that isn't the card in
 * front of you — start, go to, ask, tell, rule, find — so advanced actions
 * never clutter the page. "Ask about all work" answers in place.
 */
export const CommandPalette: React.FC<CommandPaletteProps> = ({
  items,
  fullScreen,
  onFind,
  onClose,
}) => {
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState(0);
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<BuilderAskAnswer | null>(null);
  const [askAll, { isLoading }] = useAskBuilderAllWorkMutation();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), [asking]);

  const all: PaletteItem[] = useMemo(
    () => [
      ...items,
      {
        id: "find",
        label: strings.find,
        kind: strings.kinds.history,
        run: () => onFind(q.replace(/^find\s*/i, "")),
      },
      { id: "ask-all", label: strings.askAll, kind: strings.kinds.ask, run: () => setAsking(true) },
    ],
    [items, onFind, q],
  );
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return all;
    return all.filter(
      item => item.label.toLowerCase().includes(needle) || item.kind.toLowerCase().includes(needle),
    );
  }, [all, q]);

  useEffect(() => setSelected(0), [q]);

  const runAsk = async () => {
    const question = q.trim();
    if (!question) return;
    try {
      setAnswer(await askAll(question).unwrap());
    } catch {
      setAnswer({
        historyId: null,
        answer: en.builder.room.composer.failed,
        basedOn: [],
        suggestedInstruction: null,
      });
    }
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (asking) {
      if (event.key === "Enter") {
        event.preventDefault();
        void runAsk();
      }
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelected(index => Math.min(filtered.length - 1, index + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelected(index => Math.max(0, index - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const item = filtered[selected];
      // Each item closes or replaces the palette itself, so its navigation can't race a close.
      if (item && !item.disabled) item.run();
    }
  };

  return (
    <div className="fixed inset-0 z-[70]" role="presentation" onKeyDown={onKeyDown}>
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 h-full w-full cursor-default bg-black/50"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={asking ? strings.askAllTitle : en.builder.room.find}
        className={[
          "absolute flex flex-col border border-neutral-500 bg-white shadow-xl",
          fullScreen
            ? "inset-0 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]"
            : "left-1/2 top-[12vh] w-[min(560px,calc(100%-32px))] -translate-x-1/2",
        ].join(" ")}
      >
        <div className="flex items-center border-b border-border-light">
          <label className="sr-only" htmlFor="room-palette">
            {asking ? strings.askAllTitle : strings.placeholder}
          </label>
          <input
            id="room-palette"
            ref={inputRef}
            value={q}
            onChange={event => setQ(event.target.value)}
            autoComplete="off"
            placeholder={asking ? strings.askAllPlaceholder : strings.placeholder}
            className="h-12 min-w-0 flex-1 px-4 text-base focus:outline-none"
          />
          {fullScreen && (
            <button type="button" className="h-12 px-4 text-sm" onClick={onClose}>
              {en.builder.room.card.cancel}
            </button>
          )}
        </div>
        {asking ? (
          <div className="max-h-[50vh] overflow-y-auto px-4 py-3 text-sm" aria-live="polite">
            {isLoading ? (
              <p className="text-typography-500">{en.builder.room.session.answering}</p>
            ) : answer ? (
              <>
                <p className="whitespace-pre-wrap">{answer.answer}</p>
                {answer.basedOn.length > 0 && (
                  <p className="mt-2 text-xs text-typography-500">
                    {en.builder.room.session.basedOn(answer.basedOn.join(" · "))}
                  </p>
                )}
              </>
            ) : null}
          </div>
        ) : (
          <ul role="listbox" className="max-h-[50vh] overflow-y-auto py-1.5">
            {filtered.length ? (
              filtered.map((item, index) => (
                <li
                  key={item.id}
                  role="option"
                  aria-selected={index === selected}
                  aria-disabled={item.disabled}
                  onMouseEnter={() => setSelected(index)}
                  onClick={() => {
                    if (item.disabled) return;
                    item.run();
                  }}
                  className={[
                    "flex min-h-[40px] cursor-pointer items-center justify-between gap-3 px-4 py-2 text-sm",
                    index === selected ? "bg-neutral-100 shadow-[inset_3px_0_0_#161616]" : "",
                    item.disabled ? "cursor-default text-typography-400" : "",
                  ].join(" ")}
                >
                  <span className="min-w-0 truncate">{item.label}</span>
                  <span className="shrink-0 text-xs text-typography-500">
                    {item.disabled ? (item.disabledLabel ?? item.kind) : item.kind}
                  </span>
                </li>
              ))
            ) : (
              <li className="px-4 py-2 text-sm text-typography-400">{strings.none}</li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
};

/** The `?` sheet: every key, grouped by where it works. */
export const KeysList: React.FC = () => {
  const keys = en.builder.room.keys;
  const groups: [string, string[]][] = [
    [keys.decision, ["pick", "enter", "custom", "later", "rule", "open", "undo"]],
    [keys.list, ["list", "move", "openRow", "back"]],
    [keys.anywhere, ["nav", "composer", "tell", "palette"]],
  ];
  return (
    <div className="flex flex-col gap-4 text-sm">
      {groups.map(([title, ids]) => (
        <section key={title}>
          <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-typography-600">
            {title}
          </h3>
          <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5">
            {ids.map(id => (
              <React.Fragment key={id}>
                <dt>
                  <kbd className="border border-neutral-500 px-1.5 font-mono text-xs">
                    {keys.items[id][0]}
                  </kbd>
                </dt>
                <dd>{keys.items[id][1]}</dd>
              </React.Fragment>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
};
