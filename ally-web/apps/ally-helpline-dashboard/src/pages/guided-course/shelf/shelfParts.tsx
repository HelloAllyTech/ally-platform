import { FC, ReactNode, useState } from "react";

import { useTranslation } from "react-i18next";

/** The Shelf's utility panels (plan §10 `shelf/`), opened from the journey menu. */
export type ShelfUtility = "notebook" | "memory" | "preferences";

export const SHELF_UTILITIES: ShelfUtility[] = ["notebook", "memory", "preferences"];

/** A scrolling page inside the Shelf (the item players own their own scrolling; these don't). */
export const UtilityPage: FC<{ children: ReactNode; testId: string }> = ({ children, testId }) => (
  <div className="h-full overflow-y-auto bg-[var(--g-card)]" data-testid={testId}>
    <div className="flex flex-col gap-4 px-4 py-4">{children}</div>
  </div>
);

export const ShelfLoading: FC = () => {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3" role="status" aria-label={t("guide.shelf.loading")}>
      <div className="g-skeleton h-4 w-2/3" />
      <div className="g-skeleton h-4 w-full" />
      <div className="g-skeleton h-4 w-5/6" />
    </div>
  );
};

export const ShelfLoadFailed: FC<{ onRetry: () => void }> = ({ onRetry }) => {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-start gap-3" role="status">
      <p className="g-prose">{t("guide.shelf.loadFailed")}</p>
      <button type="button" onClick={onRetry} className={quietButton}>
        {t("guide.common.retry")}
      </button>
    </div>
  );
};

export const quietButton =
  "min-h-11 rounded-[10px] border border-[var(--g-line)] bg-[var(--g-card)] px-3 font-primary text-sm text-[var(--g-ink)] hover:border-[var(--g-ink-faint)] disabled:opacity-50";

export const linkButton =
  "min-h-11 font-primary text-sm text-[var(--g-ink-soft)] underline underline-offset-2 disabled:opacity-50";

/**
 * An on/off setting. A real switch (`role="switch"`), with the label and the
 * line explaining it read together.
 */
export const SettingSwitch: FC<{
  label: string;
  hint?: string | null;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  testId?: string;
}> = ({ label, hint, checked, disabled, onChange, testId }) => (
  <div className="flex items-start gap-3">
    <div className="min-w-0 flex-1">
      <p className="font-primary text-[15px] font-semibold text-[var(--g-ink)]">{label}</p>
      {hint && <p className="font-primary text-sm text-[var(--g-ink-soft)]">{hint}</p>}
    </div>
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      data-testid={testId}
      onClick={() => onChange(!checked)}
      className={`relative mt-0.5 h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
        checked ? "bg-[var(--g-action)]" : "bg-[var(--g-line)]"
      }`}
    >
      <span
        aria-hidden="true"
        className={`absolute top-1 h-5 w-5 rounded-full bg-[var(--g-card)] shadow transition-[left] ${
          checked ? "left-6" : "left-1"
        }`}
      />
    </button>
  </div>
);

/**
 * Remove with a second, explicit tap: "Delete this?" · Delete · Keep. Nothing
 * here can be undone, so it never happens on one tap.
 */
export const ConfirmRemove: FC<{
  label: string;
  question: string;
  confirmLabel: string;
  onConfirm: () => void;
  busy?: boolean;
}> = ({ label, question, confirmLabel, onConfirm, busy }) => {
  const { t } = useTranslation();
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button type="button" className={linkButton} onClick={() => setAsking(true)} disabled={busy}>
        {label}
      </button>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-x-3" role="group" aria-label={question}>
      <span className="font-primary text-sm text-[var(--g-ink)]">{question}</span>
      <button
        type="button"
        className={`${linkButton} font-semibold text-[var(--g-ink)]`}
        onClick={() => {
          setAsking(false);
          onConfirm();
        }}
        disabled={busy}
      >
        {confirmLabel}
      </button>
      <button type="button" className={linkButton} onClick={() => setAsking(false)}>
        {t("guide.shelf.keep")}
      </button>
    </span>
  );
};

/** "12 Oct", in the reader's language. */
export const shortDate = (iso: string | null | undefined, language: string): string | null => {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  try {
    return new Intl.DateTimeFormat(language, { day: "numeric", month: "short" }).format(date);
  } catch {
    return date.toDateString();
  }
};
