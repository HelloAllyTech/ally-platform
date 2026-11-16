import React, { useEffect, useId, useMemo, useRef, useState } from "react";

/**
 * Form controls for the v2 owner screens (chunk 5b): a select, a searchable combobox, a switch,
 * status pills, skeletons and a date-and-time picker. Native `<select>` and `<details>` aren't used
 * on these screens; these follow the WAI-ARIA patterns (listbox button, combobox with a listbox,
 * switch, grid) so the keyboard and screen readers work as they do with the native controls.
 */

export interface SelectOption {
  value: string;
  label: string;
  /** A second line, quieter (a hint). */
  hint?: string;
}

const useOutside = (open: boolean, close: () => void, ...refs: React.RefObject<HTMLElement>[]) => {
  useEffect(() => {
    if (!open) return undefined;
    const away = (event: MouseEvent) => {
      if (refs.every(ref => !ref.current?.contains(event.target as Node))) close();
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
};

/** A listbox button: the v2 select. Arrow keys move, Enter or Space picks, Esc closes. */
export const Select: React.FC<{
  label: string;
  /** Shown as the field's label above the button; omit it when a label sits elsewhere. */
  showLabel?: boolean;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  compact?: boolean;
  testId?: string;
}> = ({
  label,
  showLabel = true,
  value,
  options,
  onChange,
  placeholder,
  disabled,
  invalid,
  describedBy,
  compact,
  testId,
}) => {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const chosen = options.find(option => option.value === value);
  useOutside(open, () => setOpen(false), button, list);

  useEffect(() => {
    if (open) {
      setActive(
        Math.max(
          0,
          options.findIndex(option => option.value === value),
        ),
      );
      list.current?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const pick = (index: number) => {
    const option = options[index];
    if (option) onChange(option.value);
    setOpen(false);
    button.current?.focus();
  };

  const onListKey = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive(at => (at + step + options.length) % options.length);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setActive(event.key === "Home" ? 0 : options.length - 1);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      pick(active);
    } else if (event.key === "Escape" || event.key === "Tab") {
      if (event.key === "Escape") event.preventDefault();
      setOpen(false);
      button.current?.focus();
    }
  };

  return (
    <div className={`ally-select${compact ? " ally-select--compact" : ""}`} data-testid={testId}>
      {showLabel && (
        <span id={`${id}-label`} className="ally-field__label">
          {label}
        </span>
      )}
      <button
        ref={button}
        type="button"
        className="ally-select__button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={showLabel ? `${id}-label ${id}-value` : undefined}
        aria-label={showLabel ? undefined : `${label}: ${chosen?.label ?? placeholder ?? ""}`}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
        onKeyDown={event => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span id={`${id}-value`} className={chosen ? undefined : "ally-select__placeholder"}>
          {chosen?.label ?? placeholder ?? ""}
        </span>
        <Chevron />
      </button>
      {open && (
        <ul
          ref={list}
          className="ally-select__list"
          role="listbox"
          tabIndex={-1}
          aria-label={label}
          aria-activedescendant={`${id}-opt-${active}`}
          onKeyDown={onListKey}
        >
          {options.map((option, index) => (
            <li
              key={option.value}
              id={`${id}-opt-${index}`}
              role="option"
              aria-selected={option.value === value}
              className={`ally-select__option${index === active ? " is-active" : ""}`}
              onMouseEnter={() => setActive(index)}
              onMouseDown={event => event.preventDefault()}
              onClick={() => pick(index)}
            >
              <span>{option.label}</span>
              {option.hint && <span className="ally-select__hint">{option.hint}</span>}
              {option.value === value && <Tick />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

/**
 * A searchable combobox: type to search, arrows move, Enter picks. `onSearch` asks for matches
 * (the parent fetches them); `options` are what to show now.
 */
export const Combobox: React.FC<{
  label: string;
  /** What shows as the label, when it carries more than words (a "Needed" tag). */
  labelNode?: React.ReactNode;
  value: SelectOption | null;
  options: SelectOption[];
  onSearch: (query: string) => void;
  onChange: (option: SelectOption | null) => void;
  placeholder?: string;
  emptyText: string;
  loading?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  testId?: string;
}> = ({
  label,
  labelNode,
  value,
  options,
  onSearch,
  onChange,
  placeholder,
  emptyText,
  loading,
  disabled,
  invalid,
  describedBy,
  testId,
}) => {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  useOutside(open, () => setOpen(false), input, list);

  useEffect(() => {
    if (!open) return undefined;
    const timer = setTimeout(() => onSearch(query), 200);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, open]);
  useEffect(() => setActive(0), [options]);

  const pick = (option: SelectOption) => {
    onChange(option);
    setQuery("");
    setOpen(false);
  };

  return (
    <div className="ally-combobox" data-testid={testId}>
      <label htmlFor={`${id}-input`} className="ally-field__label">
        {labelNode ?? label}
      </label>
      <div className="ally-combobox__box">
        <SearchIcon />
        <input
          ref={input}
          id={`${id}-input`}
          className="ally-input ally-combobox__input"
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={open && options.length ? `${id}-opt-${active}` : undefined}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          disabled={disabled}
          placeholder={value ? value.label : placeholder}
          value={open ? query : (value?.label ?? "")}
          onFocus={() => setOpen(true)}
          onChange={event => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onKeyDown={event => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setOpen(true);
              const step = event.key === "ArrowDown" ? 1 : -1;
              setActive(at => (options.length ? (at + step + options.length) % options.length : 0));
            } else if (event.key === "Enter" && open && options[active]) {
              event.preventDefault();
              pick(options[active]);
            } else if (event.key === "Escape") {
              setOpen(false);
              setQuery("");
            }
          }}
        />
      </div>
      {open && (
        <ul
          ref={list}
          id={`${id}-list`}
          className="ally-select__list"
          role="listbox"
          aria-label={label}
        >
          {loading && !options.length ? (
            <li className="ally-select__empty" aria-hidden="true">
              <Skeleton width="60%" />
            </li>
          ) : options.length ? (
            options.map((option, index) => (
              <li
                key={option.value}
                id={`${id}-opt-${index}`}
                role="option"
                aria-selected={option.value === value?.value}
                className={`ally-select__option${index === active ? " is-active" : ""}`}
                onMouseEnter={() => setActive(index)}
                onMouseDown={event => event.preventDefault()}
                onClick={() => pick(option)}
              >
                <span>{option.label}</span>
                {option.hint && <span className="ally-select__hint">{option.hint}</span>}
                {option.value === value?.value && <Tick />}
              </li>
            ))
          ) : (
            <li className="ally-select__empty">{emptyText}</li>
          )}
        </ul>
      )}
    </div>
  );
};

/** An on/off switch with its words beside it. */
export const Switch: React.FC<{
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}> = ({ label, hint, checked, onChange, disabled }) => {
  const id = useId();
  return (
    <div className="ally-switch-row">
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className="ally-switch"
        disabled={disabled}
        onClick={() => onChange(!checked)}
      >
        <span className="ally-switch__thumb" aria-hidden="true" />
      </button>
      <label htmlFor={id} className="ally-switch-row__text">
        <span>{label}</span>
        {hint && (
          <span id={`${id}-hint`} className="ally-field__hint">
            {hint}
          </span>
        )}
      </label>
    </div>
  );
};

export type StatusTone = "new" | "active" | "done" | "stopped" | "neutral";

/** A status as a coloured pill. The tone follows where it sits in the list's order. */
export const StatusPill: React.FC<{ label: string; tone: StatusTone }> = ({ label, tone }) => (
  <span className={`ally-status-pill ally-status-pill--${tone}`}>{label}</span>
);

/** A grey bar while something loads. Hidden from screen readers; the region says it's busy. */
export const Skeleton: React.FC<{ width?: string; height?: number }> = ({
  width = "100%",
  height = 14,
}) => <span className="ally-skeleton" style={{ width, height }} aria-hidden="true" />;

// ---- Date and time --------------------------------------------------------------------------

export interface PickerLabels {
  date: string;
  time: string;
  previousMonth: string;
  nextMonth: string;
  today: string;
}

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = (s: string): Date | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
};

/**
 * A date picker: the chosen day on a button, a month grid under it. `value` is `YYYY-MM-DD` (a
 * wall date, no zone). Arrow keys move by day and week, Page Up and Down by month.
 */
export const DatePicker: React.FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  labels: PickerLabels;
  /** How the chosen day reads on the button ("Thu 19 Nov"). */
  format: (value: string) => string;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  today: string;
}> = ({
  label,
  value,
  onChange,
  labels,
  format,
  placeholder,
  disabled,
  invalid,
  describedBy,
  today,
}) => {
  const id = useId();
  const [open, setOpen] = useState(false);
  const chosen = parseYmd(value);
  const [focus, setFocus] = useState<Date>(chosen ?? parseYmd(today) ?? new Date());
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useOutside(open, () => setOpen(false), button, panel);

  useEffect(() => {
    if (open) {
      setFocus(chosen ?? parseYmd(today) ?? new Date());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => {
    if (open) panel.current?.querySelector<HTMLElement>("[data-focus=true]")?.focus();
  }, [open, focus]);

  const month = focus.getMonth();
  const year = focus.getFullYear();
  const weeks = useMemo(() => {
    const first = new Date(year, month, 1);
    const offset = (first.getDay() + 6) % 7; // Monday first
    const start = new Date(year, month, 1 - offset);
    return Array.from({ length: 6 }, (_, w) =>
      Array.from(
        { length: 7 },
        (_, d) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + d),
      ),
    );
  }, [month, year]);
  const monthName = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" }).format(
    focus,
  );
  const dayNames = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

  const move = (days: number, months = 0) =>
    setFocus(f => new Date(f.getFullYear(), f.getMonth() + months, f.getDate() + days));
  const pick = (d: Date) => {
    onChange(ymd(d));
    setOpen(false);
    button.current?.focus();
  };

  return (
    <div className="ally-datepicker">
      <span id={`${id}-label`} className="ally-field__label">
        {label}
      </span>
      <button
        ref={button}
        type="button"
        className="ally-select__button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-labelledby={`${id}-label ${id}-value`}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
      >
        <span id={`${id}-value`} className={value ? undefined : "ally-select__placeholder"}>
          {value ? format(value) : (placeholder ?? labels.date)}
        </span>
        <CalendarIcon />
      </button>
      {open && (
        <div ref={panel} className="ally-calendar" role="dialog" aria-label={labels.date}>
          <div className="ally-calendar__head">
            <button
              type="button"
              className="ally-icon-btn"
              aria-label={labels.previousMonth}
              onClick={() => move(0, -1)}
            >
              ‹
            </button>
            <span className="ally-calendar__month" aria-live="polite">
              {monthName}
            </span>
            <button
              type="button"
              className="ally-icon-btn"
              aria-label={labels.nextMonth}
              onClick={() => move(0, 1)}
            >
              ›
            </button>
          </div>
          <table
            role="grid"
            className="ally-calendar__grid"
            aria-label={monthName}
            onKeyDown={event => {
              const keys: Record<string, () => void> = {
                ArrowLeft: () => move(-1),
                ArrowRight: () => move(1),
                ArrowUp: () => move(-7),
                ArrowDown: () => move(7),
                PageUp: () => move(0, -1),
                PageDown: () => move(0, 1),
                Enter: () => pick(focus),
                " ": () => pick(focus),
                Escape: () => {
                  setOpen(false);
                  button.current?.focus();
                },
              };
              if (keys[event.key]) {
                event.preventDefault();
                keys[event.key]();
              }
            }}
          >
            <thead>
              <tr>
                {dayNames.map(name => (
                  <th key={name} scope="col" abbr={name}>
                    {name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {weeks.map((week, w) => (
                <tr key={w}>
                  {week.map(day => {
                    const key = ymd(day);
                    const isFocus = key === ymd(focus);
                    return (
                      <td key={key} role="gridcell" aria-selected={key === value}>
                        <button
                          type="button"
                          tabIndex={isFocus ? 0 : -1}
                          data-focus={isFocus}
                          className={[
                            "ally-calendar__day",
                            day.getMonth() !== month ? "is-other" : "",
                            key === today ? "is-today" : "",
                            key === value ? "is-chosen" : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                          aria-label={new Intl.DateTimeFormat("en-GB", {
                            weekday: "long",
                            day: "numeric",
                            month: "long",
                            year: "numeric",
                          }).format(day)}
                          onClick={() => pick(day)}
                        >
                          {day.getDate()}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <button
            type="button"
            className="ally-btn ally-btn--ghost ally-calendar__today"
            onClick={() => pick(parseYmd(today) ?? new Date())}
          >
            {labels.today}
          </button>
        </div>
      )}
    </div>
  );
};

/** Times of day every `step` minutes, as `HH:MM`. */
export const timesOfDay = (step = 15): string[] =>
  Array.from({ length: Math.floor((24 * 60) / step) }, (_, i) => {
    const m = i * step;
    return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
  });

/** A time of day, from a list every `step` minutes. `value` is `HH:MM`. */
export const TimePicker: React.FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  step?: number;
  showLabel?: boolean;
  disabled?: boolean;
  invalid?: boolean;
}> = ({ label, value, onChange, step = 15, showLabel = true, disabled, invalid }) => {
  const options = useMemo(() => {
    const times = timesOfDay(step);
    if (value && !times.includes(value)) times.push(value);
    return times.sort().map(t => ({ value: t, label: t }));
  }, [step, value]);
  return (
    <Select
      label={label}
      showLabel={showLabel}
      value={value}
      options={options}
      onChange={onChange}
      placeholder="--:--"
      disabled={disabled}
      invalid={invalid}
    />
  );
};

// ---- Icons ------------------------------------------------------------------------------------

const Chevron = () => (
  <svg
    aria-hidden="true"
    viewBox="0 0 20 20"
    width="16"
    height="16"
    className="ally-select__chevron"
  >
    <path
      d="M5 8l5 5 5-5"
      stroke="currentColor"
      strokeWidth="1.6"
      fill="none"
      strokeLinecap="round"
    />
  </svg>
);
const Tick = () => (
  <svg aria-hidden="true" viewBox="0 0 20 20" width="16" height="16" className="ally-select__tick">
    <path
      d="M4 10.5l4 4 8-9"
      stroke="currentColor"
      strokeWidth="1.8"
      fill="none"
      strokeLinecap="round"
    />
  </svg>
);
const SearchIcon = () => (
  <svg
    aria-hidden="true"
    viewBox="0 0 20 20"
    width="16"
    height="16"
    className="ally-combobox__icon"
  >
    <circle cx="9" cy="9" r="5.5" stroke="currentColor" strokeWidth="1.6" fill="none" />
    <path d="M13 13l4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);
const CalendarIcon = () => (
  <svg
    aria-hidden="true"
    viewBox="0 0 20 20"
    width="16"
    height="16"
    className="ally-select__chevron"
  >
    <rect
      x="3"
      y="4.5"
      width="14"
      height="12"
      rx="2"
      stroke="currentColor"
      strokeWidth="1.5"
      fill="none"
    />
    <path
      d="M3 8.5h14M7 3v3M13 3v3"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
  </svg>
);
