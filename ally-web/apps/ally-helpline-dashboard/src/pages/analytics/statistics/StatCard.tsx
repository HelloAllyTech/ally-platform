import { FunctionComponent, ReactNode } from "react";

import { useTranslation } from "react-i18next";

import { Button, InlineNotification, SkeletonPlaceholder } from "@ally-ui-mono/ui-shared";

interface StatCardProps {
  /** The question the card answers. It is the heading, not the chart's name. */
  title: string;
  /** One plain-language sentence that says what the data shows. */
  takeaway?: string | null;
  /** The card's filters, shown under the heading whatever state the chart is in. */
  controls?: ReactNode;
  /** Pins the card to For you. Absent when the chart cannot be pinned or the page is being customised. */
  pin?: { pinned: boolean; label: string; onToggle: () => void };
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
  children?: ReactNode;
}

/**
 * The card every Statistics chart sits in: the question as the heading, then a
 * takeaway sentence a first-time reader gets in five seconds, then the chart.
 * Owns the loading and error states so one slow chart never blanks the page.
 */
export const StatCard: FunctionComponent<StatCardProps> = ({
  title,
  takeaway,
  controls,
  pin,
  loading = false,
  error = false,
  onRetry,
  children,
}) => {
  const { t } = useTranslation();
  return (
    <section
      className="flex h-full flex-col gap-3 rounded-xl border border-[#e3ded2] bg-white p-5 md:px-6"
      aria-busy={loading}
    >
      <header className="relative">
        {pin && (
          <button
            type="button"
            aria-label={pin.label}
            aria-pressed={pin.pinned}
            onClick={pin.onToggle}
            className="absolute -right-3 -top-3 flex h-11 w-11 items-center justify-center rounded text-typography-500 hover:bg-background-secondary"
            data-testid="statistics-pin"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill={pin.pinned ? "#2A5DB0" : "none"}
              stroke={pin.pinned ? "#2A5DB0" : "currentColor"}
              strokeWidth="2"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M9 3h6l-1 6 4 4v2h-5v6h-2v-6H6v-2l4-4z" />
            </svg>
          </button>
        )}
        <h2 className={`text-base font-semibold text-typography-900 ${pin ? "pr-8" : ""}`}>
          {title}
        </h2>
        {takeaway && !loading && !error && (
          <p className="mt-1 text-sm text-typography-600" data-testid="statistics-takeaway">
            {takeaway}
          </p>
        )}
      </header>
      {controls}
      {loading ? (
        <div className="flex flex-col gap-2" role="status">
          <span className="text-sm text-typography-600">{t("statisticsLibrary.card.loading")}</span>
          <SkeletonPlaceholder className="analytics-chart-skeleton" />
        </div>
      ) : error ? (
        <div className="flex flex-col items-start gap-3">
          <InlineNotification
            kind="error"
            lowContrast
            hideCloseButton
            title={t("statisticsLibrary.card.couldNotLoad")}
          />
          {onRetry && (
            <Button kind="tertiary" size="sm" onClick={onRetry}>
              {t("statisticsLibrary.card.retry")}
            </Button>
          )}
        </div>
      ) : (
        children
      )}
    </section>
  );
};
