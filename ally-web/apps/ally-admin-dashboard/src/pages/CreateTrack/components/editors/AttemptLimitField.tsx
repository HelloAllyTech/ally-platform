import { FC, useState } from "react";

interface AttemptLimitFieldProps {
  /** The form's current limit; `null` = unlimited. */
  value: number | null | undefined;
  onChange: (value: number | null) => void;
  /** What the server holds for this item; `undefined` when it has never been saved. */
  savedValue: number | null | undefined;
  /**
   * The course is published and this item exists on the server. The limit can
   * then only go up, through its own endpoint: the structure PUT treats it as
   * structural and 409s once learners are enrolled.
   */
  isLive: boolean;
  /** The caller may author courses (Create Courses). */
  canEdit: boolean;
}

const numberInput =
  "w-24 border border-border-light rounded-md px-2 py-1 text-sm outline-none focus:border-primary-400 disabled:opacity-50";

/**
 * An attempt limit: an Unlimited checkbox beside a number box. Shared by every
 * component that has one (quiz, annotation) so the live-course rules match.
 *
 * Emptying the box while retyping must not read as "Unlimited" (that is the
 * checkbox's job), so an empty box is only a local draft: the form keeps its
 * last number until a new one is typed, and blur restores it.
 *
 * On a live course the floor is the saved limit + 1; an already-unlimited item
 * has nothing higher, so both controls lock.
 */
export const AttemptLimitField: FC<AttemptLimitFieldProps> = ({
  value,
  onChange,
  savedValue,
  isLive,
  canEdit,
}) => {
  const [draft, setDraft] = useState<string | null>(null);
  const saved = savedValue ?? null;
  const locked = isLive && (!canEdit || saved === null);
  const min = isLive && saved !== null ? saved + 1 : 1;
  const unlimited = value == null;

  return (
    <div className="flex items-center gap-2">
      <label className="flex items-center gap-1 text-xs text-typography-600">
        <input
          type="checkbox"
          checked={unlimited}
          disabled={locked}
          onChange={event => onChange(event.target.checked ? null : isLive ? saved : 1)}
        />
        Unlimited
      </label>
      <input
        type="number"
        min={min}
        disabled={unlimited || locked}
        className={numberInput}
        value={draft ?? value ?? ""}
        onChange={event => {
          const text = event.target.value;
          if (text === "") {
            setDraft("");
            return;
          }
          setDraft(null);
          onChange(Number(text));
        }}
        onBlur={() => {
          setDraft(null);
          // `min` only constrains the spinner and validity, not typing.
          if (isLive && value != null && value < min) {
            onChange(saved);
          }
        }}
        onWheel={event => event.currentTarget.blur()}
      />
    </div>
  );
};
