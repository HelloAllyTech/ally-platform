import React, { useEffect, useRef, useState } from "react";

import { Kbd } from "./Button";
import { isTypingTarget, optionKey } from "./keys";

export interface OptionItem {
  id: string;
  label: string;
  hint?: string;
  disabled?: boolean;
}

/** How long a picked option shows its tick before the screen moves on (DESIGN.md §4). */
export const AUTO_ADVANCE_MS = 380;

/**
 * Lettered options (DESIGN.md §4). Single choice: picking one (click, or its letter key) shows the
 * tick, then calls `onChoose` after 380 ms. ↑/↓ move between options and Enter picks the focused
 * one. Letter keys work while the list is on screen, unless focus is in a text field.
 * `keysHint` is announced to screen readers ("Press A, B or C to choose").
 */
export const OptionList: React.FC<{
  options: OptionItem[];
  onChoose: (option: OptionItem) => void;
  selected?: string | null;
  disabled?: boolean;
  label: string;
  keysHint?: string;
  /** Turn letter keys off (for example while another list on the screen owns them). */
  letterKeys?: boolean;
}> = ({
  options,
  onChoose,
  selected = null,
  disabled = false,
  label,
  keysHint,
  letterKeys = true,
}) => {
  const [picked, setPicked] = useState<string | null>(selected);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const choose = useRef<(option: OptionItem) => void>(() => undefined);

  // A new `selected` from the parent replaces the local pick (React's "adjust state on prop change").
  const [shown, setShown] = useState(selected);
  if (shown !== selected) {
    setShown(selected);
    setPicked(selected);
  }
  useEffect(() => () => clearTimeout(timer.current), []);

  useEffect(() => {
    choose.current = option => {
      if (disabled || option.disabled || timer.current) return;
      setPicked(option.id);
      timer.current = setTimeout(() => {
        timer.current = undefined;
        onChoose(option);
      }, AUTO_ADVANCE_MS);
    };
  });

  useEffect(() => {
    if (!letterKeys || disabled) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.key.length !== 1) return;
      const target = event.target as HTMLElement | null;
      if (isTypingTarget(target) && !target?.closest?.(".ally-options")) return;
      const index = event.key.toUpperCase().charCodeAt(0) - 65;
      const option = options[index];
      if (index >= 0 && option) {
        event.preventDefault();
        refs.current[index]?.focus();
        choose.current(option);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [options, letterKeys, disabled]);

  const move = (from: number, by: number) => {
    const n = options.length;
    for (let step = 1; step <= n; step += 1) {
      const next = (from + by * step + n) % n;
      if (!options[next].disabled) {
        refs.current[next]?.focus();
        return;
      }
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-describedby={keysHint ? "ally-options-keys" : undefined}
    >
      {keysHint && (
        <span id="ally-options-keys" className="ally-sr-only">
          {keysHint}
        </span>
      )}
      <ul className="ally-options">
        {options.map((option, index) => (
          <li
            key={option.id}
            className="ally-rise"
            style={{ ["--ally-i" as string]: Math.min(index, 8) }}
          >
            <button
              ref={el => (refs.current[index] = el)}
              type="button"
              role="radio"
              aria-checked={picked === option.id}
              tabIndex={(picked ?? options.find(o => !o.disabled)?.id) === option.id ? 0 : -1}
              disabled={disabled || option.disabled}
              className="ally-option ally-press"
              onClick={() => choose.current(option)}
              onKeyDown={event => {
                if (event.key === "ArrowDown" || event.key === "ArrowRight") {
                  event.preventDefault();
                  move(index, 1);
                } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
                  event.preventDefault();
                  move(index, -1);
                } else if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  choose.current(option);
                }
              }}
            >
              <span className="ally-option__key">
                <Kbd>{optionKey(index)}</Kbd>
              </span>
              <span className="ally-option__text">
                <span>{option.label}</span>
                {option.hint && <span className="ally-option__hint">{option.hint}</span>}
              </span>
              {picked === option.id && (
                <span className="ally-option__tick ally-pop" aria-hidden="true">
                  ✓
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};

/** "Press A, B or C to choose", from a template with `{keys}`. */
export const keysHintFor = (template: string, count: number, or = "or"): string => {
  const keys = Array.from({ length: count }, (_, i) => optionKey(i));
  const list =
    keys.length > 1
      ? `${keys.slice(0, -1).join(", ")} ${or} ${keys[keys.length - 1]}`
      : (keys[0] ?? "");
  return template.replace("{keys}", list);
};
