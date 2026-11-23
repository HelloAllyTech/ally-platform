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
      <header>
        <h2 className="text-base font-semibold text-typography-900">{title}</h2>
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
            subtitle={t("statisticsLibrary.card.couldNotLoadDetail")}
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
