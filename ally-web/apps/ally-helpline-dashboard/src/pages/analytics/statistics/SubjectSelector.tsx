import { FunctionComponent, useState } from "react";

import { useTranslation } from "react-i18next";

import { useGetStatisticsScopeOptionsQuery } from "@api";
import type { StatisticsFilterKey } from "@types";

import { ScopeChooser } from "./ScopeChooser";

interface SubjectSelectorProps {
  /** What the tab asks you to choose. */
  kind: StatisticsFilterKey;
  /** The id chosen, if any. */
  value?: string;
  onChange: (id: string) => void;
}

/**
 * The course or learner a tab is about. Shows the name of the one chosen (asked
 * from the backend by id, so a choice remembered from last time is named too)
 * and opens the same searchable list the card filters use.
 */
export const SubjectSelector: FunctionComponent<SubjectSelectorProps> = ({
  kind,
  value,
  onChange,
}) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<{ id: string; label: string } | null>(null);

  const { data } = useGetStatisticsScopeOptionsQuery({ kind, id: value }, { skip: !value });
  const label = value ? (picked?.id === value ? picked.label : data?.[0]?.label) : undefined;

  return (
    <div className="flex flex-col gap-2" data-testid="statistics-subject">
      <span className="text-xs text-typography-600">
        {t(`statisticsLibrary.subject.label.${kind}`)}
      </span>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(current => !current)}
        className={`flex min-h-11 min-w-[260px] max-w-full items-center justify-between gap-3 rounded border bg-white px-3 text-left text-sm font-medium ${
          value ? "border-[#264d8e] text-typography-900" : "border-border-light text-typography-600"
        }`}
        data-testid="statistics-subject-button"
      >
        <span className="truncate">{label ?? t(`statisticsLibrary.subject.choose.${kind}`)}</span>
        <span aria-hidden>▾</span>
      </button>
      {open && (
        <div
          className="rounded border border-border-light bg-white p-3 shadow-sm"
          data-testid="statistics-subject-menu"
        >
          <ScopeChooser
            kind={kind}
            onCancel={() => setOpen(false)}
            onPick={option => {
              setPicked(option);
              setOpen(false);
              onChange(option.id);
            }}
          />
        </div>
      )}
    </div>
  );
};
