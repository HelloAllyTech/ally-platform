import React from "react";

import { Add, Delete } from "@icons";

import { Button, Select, SelectItem, TextArea, Tooltip } from "@ally-ui-mono/ui-shared";
import { TooltipIcon } from "@assets";
import { en } from "@constants";
import type { BuilderEvalChecklistItem, BuilderEvalChecklistKind } from "@types";

import { MAX_CHECKLIST_ITEMS, MAX_CHECKLIST_TEXT, nextChecklistId } from "./evalFormat";

interface ChecklistEditorProps {
  items: BuilderEvalChecklistItem[];
  onChange: (items: BuilderEvalChecklistItem[]) => void;
  disabled?: boolean;
}

/**
 * The ground truth a person writes once for a fixture: what a correct PRD says
 * (`must`) and must not say or plan (`must_not`). The simulated admin corrects
 * Builder wherever the checklist contradicts it, and the judge scores the final
 * PRD against it, so this is the part of a fixture that makes it worth running.
 *
 * Controlled: the panel owns the draft and decides when it is saved. Blank
 * items are tolerated while editing (a new row starts blank) and dropped on
 * save by `cleanChecklist`.
 */
export const ChecklistEditor: React.FC<ChecklistEditorProps> = ({
  items,
  onChange,
  disabled = false,
}) => {
  const strings = en.builder.eval.checklist;
  const atLimit = items.length >= MAX_CHECKLIST_ITEMS;

  const update = (id: string, patch: Partial<BuilderEvalChecklistItem>) =>
    onChange(items.map(item => (item.id === id ? { ...item, ...patch } : item)));

  const remove = (id: string) => onChange(items.filter(item => item.id !== id));

  const add = () =>
    onChange([...items, { id: nextChecklistId(items), text: "", kind: "must" as const }]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-1.5">
        <h3 className="text-sm font-semibold text-typography-900">{strings.heading}</h3>
        <Tooltip label={strings.hint} align="top">
          <button type="button" className="cursor-pointer inline-flex items-center">
            <TooltipIcon />
          </button>
        </Tooltip>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-typography-600">{strings.empty}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map(item => (
            <li
              key={item.id}
              className="flex flex-col gap-2 border border-neutral-200 p-3 sm:flex-row sm:items-start"
            >
              <div className="flex shrink-0 items-center gap-2 sm:w-40 sm:flex-col sm:items-stretch">
                <span className="font-mono text-xs text-typography-500">{item.id}</span>
                <Select
                  id={`builder-eval-checklist-kind-${item.id}`}
                  labelText={strings.kindLabel(item.id)}
                  hideLabel
                  size="sm"
                  value={item.kind}
                  disabled={disabled}
                  onChange={event =>
                    update(item.id, { kind: event.target.value as BuilderEvalChecklistKind })
                  }
                >
                  <SelectItem value="must" text={strings.kindMust} />
                  <SelectItem value="must_not" text={strings.kindMustNot} />
                </Select>
              </div>
              <div className="min-w-0 flex-1">
                <TextArea
                  id={`builder-eval-checklist-text-${item.id}`}
                  labelText={strings.textLabel(item.id)}
                  hideLabel
                  rows={4}
                  maxCount={MAX_CHECKLIST_TEXT}
                  enableCounter
                  placeholder={
                    item.kind === "must_not" ? strings.placeholderMustNot : strings.placeholderMust
                  }
                  value={item.text}
                  disabled={disabled}
                  onChange={event => update(item.id, { text: event.target.value })}
                />
              </div>
              <Button
                kind="ghost"
                size="sm"
                hasIconOnly
                iconDescription={strings.remove(item.id)}
                renderIcon={Delete}
                disabled={disabled}
                onClick={() => remove(item.id)}
              />
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-3">
        <Button
          kind="tertiary"
          size="sm"
          renderIcon={Add}
          disabled={disabled || atLimit}
          onClick={add}
        >
          {strings.add}
        </Button>
        {atLimit && (
          <span className="text-xs text-typography-600">{strings.limit(MAX_CHECKLIST_ITEMS)}</span>
        )}
      </div>
    </div>
  );
};
