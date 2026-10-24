import React, { useState } from "react";

import { Close } from "@icons";

import { Button, TextInput } from "@ally-ui-mono/ui-shared";

interface ChipListProps {
  items: string[];
  /** What to draw for an item; defaults to the item itself (an id, a topic). */
  labelFor?: (item: string) => string;
  removeLabel: (item: string) => string;
  onRemove: (item: string) => void;
  disabled?: boolean;
  emptyText: string;
  testId?: string;
}

/** A wrapped row of removable chips. Each chip's remove button names what it removes. */
export const ChipList: React.FC<ChipListProps> = ({
  items,
  labelFor,
  removeLabel,
  onRemove,
  disabled = false,
  emptyText,
  testId,
}) => {
  if (items.length === 0) {
    return (
      <p
        className="text-sm text-typography-700"
        data-testid={testId ? `${testId}-empty` : undefined}
      >
        {emptyText}
      </p>
    );
  }
  return (
    <ul className="flex flex-wrap gap-2" data-testid={testId}>
      {items.map(item => (
        <li
          key={item}
          className="inline-flex max-w-full items-center gap-1 border border-border-light bg-background-secondary py-1 pl-3 pr-1 text-sm text-typography-900"
        >
          <span className="min-w-0 break-all" title={item}>
            {labelFor ? labelFor(item) : item}
          </span>
          <button
            type="button"
            aria-label={removeLabel(item)}
            disabled={disabled}
            onClick={() => onRemove(item)}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center text-typography-700 hover:text-typography-900 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Close size={14} aria-hidden="true" />
          </button>
        </li>
      ))}
    </ul>
  );
};

interface AddItemInputProps {
  id: string;
  label: string;
  placeholder: string;
  addLabel: string;
  disabled?: boolean;
  maxLength?: number;
  /** Returns an error message to block the add, or null to allow it. */
  validate: (value: string) => string | null;
  onAdd: (value: string) => void;
}

/** A text field and an Add button. Enter adds too. Errors show under the field and clear as the admin types. */
export const AddItemInput: React.FC<AddItemInputProps> = ({
  id,
  label,
  placeholder,
  addLabel,
  disabled = false,
  maxLength,
  validate,
  onAdd,
}) => {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    const trimmed = value.trim();
    const problem = validate(trimmed);
    if (problem) {
      setError(problem);
      return;
    }
    onAdd(trimmed);
    setValue("");
    setError(null);
  };

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
      <div className="min-w-0 flex-1">
        <TextInput
          id={id}
          labelText={label}
          hideLabel
          size="md"
          placeholder={placeholder}
          value={value}
          maxLength={maxLength}
          disabled={disabled}
          invalid={error !== null}
          invalidText={error ?? ""}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
            setValue(event.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submit();
            }
          }}
        />
      </div>
      <Button kind="tertiary" size="md" disabled={disabled} onClick={submit}>
        {addLabel}
      </Button>
    </div>
  );
};
