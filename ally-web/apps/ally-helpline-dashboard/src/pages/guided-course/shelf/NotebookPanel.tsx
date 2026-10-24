import { FC, useState } from "react";

import { useTranslation } from "react-i18next";

import {
  useDeleteGuideNotebookEntryMutation,
  useGetGuideNotebookQuery,
  useLazyExportGuideNotebookQuery,
} from "@api";

import {
  ConfirmRemove,
  quietButton,
  ShelfLoadFailed,
  ShelfLoading,
  shortDate,
  UtilityPage,
} from "./shelfParts";

const KNOWN_KINDS = [
  "first_move",
  "possible_self",
  "journal_line",
  "rehearsed_line",
  "reflection",
  "noticing",
];

/** Hands the Markdown to the browser as a file; nothing is uploaded anywhere. */
const download = (markdown: string, filename: string) => {
  const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
};

/**
 * The notebook (plan §4.7): the learner's first move, possible self, journal
 * lines, rehearsed lines, reflections and the moments Ally noticed. Theirs to
 * read, download and delete; nothing in it is scored.
 */
export const NotebookPanel: FC<{
  trackId: string;
  onExported?: (scope: "course" | "all") => void;
}> = ({ trackId, onExported }) => {
  const { t, i18n } = useTranslation();
  const [scope, setScope] = useState<"course" | "all">("course");
  const args = scope === "course" ? { trackId } : {};
  const { data, isLoading, isError, refetch } = useGetGuideNotebookQuery(args);
  const [exportNotebook, { isFetching: exporting }] = useLazyExportGuideNotebookQuery();
  const [removeEntry, { isLoading: removing }] = useDeleteGuideNotebookEntryMutation();
  const [failed, setFailed] = useState<string | null>(null);

  const onExport = async () => {
    setFailed(null);
    try {
      const markdown = await exportNotebook(args).unwrap();
      download(markdown, "notebook.md");
      onExported?.(scope);
    } catch {
      setFailed(t("guide.notebook.exportFailed"));
    }
  };

  const onRemove = async (entryId: string) => {
    setFailed(null);
    try {
      await removeEntry({ entryId }).unwrap();
    } catch {
      setFailed(t("guide.notebook.removeFailed"));
    }
  };

  return (
    <UtilityPage testId="notebook-panel">
      <p className="g-prose text-[var(--g-ink-soft)]">{t("guide.notebook.intro")}</p>
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label={t("guide.notebook.scope")} className="flex gap-1">
          {(["course", "all"] as const).map(option => (
            <button
              key={option}
              type="button"
              aria-pressed={scope === option}
              onClick={() => setScope(option)}
              className={`min-h-11 rounded-lg border px-3 font-primary text-sm ${
                scope === option
                  ? "border-[var(--g-ink)] font-semibold text-[var(--g-ink)]"
                  : "border-[var(--g-line)] text-[var(--g-ink-soft)]"
              }`}
            >
              {t(`guide.notebook.scope_${option}`)}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={`${quietButton} ml-auto`}
          onClick={() => void onExport()}
          disabled={exporting || !data?.length}
        >
          {t("guide.notebook.export")}
        </button>
      </div>
      {failed && (
        <p className="font-secondary text-sm text-[var(--g-ink)]" role="status">
          {failed}
        </p>
      )}

      {isLoading ? (
        <ShelfLoading />
      ) : isError ? (
        <ShelfLoadFailed onRetry={() => void refetch()} />
      ) : !data?.length ? (
        <p className="g-caption" data-testid="notebook-empty">
          {t("guide.notebook.empty")}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {data.map(entry => {
            const when = shortDate(entry.createdAt, i18n.language);
            const kind = KNOWN_KINDS.includes(entry.kind)
              ? t(`guide.notebook.kind.${entry.kind}`)
              : t("guide.notebook.kind.other");
            return (
              <li
                key={entry.id}
                className="rounded-[10px] border border-[var(--g-line)] px-3 py-2"
                data-testid="notebook-entry"
              >
                <p className="g-label text-[var(--g-ink-faint)]">
                  {when ? `${kind} · ${when}` : kind}
                </p>
                <p className="g-prose mt-1 whitespace-pre-wrap text-[var(--g-ink)]">{entry.text}</p>
                <div className="mt-1">
                  <ConfirmRemove
                    label={t("guide.shelf.delete")}
                    question={t("guide.notebook.deleteQuestion")}
                    confirmLabel={t("guide.shelf.delete")}
                    onConfirm={() => void onRemove(entry.id)}
                    busy={removing}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </UtilityPage>
  );
};
