import { FunctionComponent } from "react";

import { useTranslation } from "react-i18next";

import { ActionableNotification, Loading } from "@ally-ui-mono/ui-shared";
import { useGetCourseAssessmentPairsQuery } from "@api";
import { Drawer } from "@components";
import { AssessmentPair, AssessmentSummary } from "@types";

interface CourseAssessmentDrawerProps {
  open: boolean;
  onClose: () => void;
  trackId: string;
  courseTitle: string;
}

const dash = "—";

const formatNumber = (value: number | null | undefined): string =>
  value == null ? dash : String(Math.round(value * 10) / 10);

const formatGain = (value: number | null | undefined): string => {
  if (value == null) return dash;
  const rounded = Math.round(value * 10) / 10;
  return rounded > 0 ? `+${rounded}` : String(rounded);
};

/**
 * Trainer view of a course's pre/post assessments: for each pair, a cohort
 * strip and one row per learner. Cohort averages are withheld by the server
 * until enough learners have both scores, so a small group can't be
 * re-identified; the strip says so instead of showing blanks.
 */
export const CourseAssessmentDrawer: FunctionComponent<CourseAssessmentDrawerProps> = ({
  open,
  onClose,
  trackId,
  courseTitle,
}) => {
  const { t } = useTranslation();
  const { data, isLoading, isError, refetch } = useGetCourseAssessmentPairsQuery(trackId, {
    skip: !open,
  });

  const renderSide = (side: AssessmentSummary | null, testId: string) => (
    <td className="py-2 pr-3 align-top" data-testid={testId}>
      {side ? formatNumber(side.score) : dash}
      {side?.reopened && (
        <span className="ml-2 rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-typography-700">
          {t("organizationMetrics.courseAssessment.reopened")}
        </span>
      )}
    </td>
  );

  const renderPair = (pair: AssessmentPair) => {
    const { cohort, comparability } = pair;
    return (
      <section key={pair.pairKey} className="flex flex-col gap-3" data-testid="assessment-pair">
        <h4 className="text-sm font-medium text-typography-900">
          {pair.preItem.title} → {pair.postItem.title}
        </h4>

        <div
          className="grid grid-cols-4 gap-2 rounded border border-solid border-border-light p-3 text-sm"
          data-testid="assessment-cohort"
        >
          <div>
            <div className="text-typography-600">{t("organizationMetrics.courseAssessment.n")}</div>
            <div className="font-medium text-typography-900">{cohort.n}</div>
          </div>
          {cohort.suppressed ? (
            <p
              className="col-span-3 text-typography-700"
              data-testid="assessment-cohort-suppressed"
            >
              {t("organizationMetrics.courseAssessment.suppressed", { min: cohort.minGroupSize })}
            </p>
          ) : (
            <>
              <div>
                <div className="text-typography-600">
                  {t("organizationMetrics.courseAssessment.avgPre")}
                </div>
                <div className="font-medium text-typography-900">{formatNumber(cohort.avgPre)}</div>
              </div>
              <div>
                <div className="text-typography-600">
                  {t("organizationMetrics.courseAssessment.avgPost")}
                </div>
                <div className="font-medium text-typography-900">
                  {formatNumber(cohort.avgPost)}
                </div>
              </div>
              <div>
                <div className="text-typography-600">
                  {t("organizationMetrics.courseAssessment.avgGain")}
                </div>
                <div className="font-medium text-typography-900">{formatGain(cohort.avgGain)}</div>
              </div>
            </>
          )}
        </div>

        {!comparability.comparable && (
          <div
            className="rounded border border-solid border-warning-200 bg-warning-50 p-3 text-sm text-typography-800"
            data-testid="assessment-not-comparable"
          >
            <p>{t("organizationMetrics.courseAssessment.notComparable")}</p>
            {comparability.onlyInPre.length > 0 && (
              <p className="mt-1">
                {t("organizationMetrics.courseAssessment.onlyInPre", {
                  list: comparability.onlyInPre.join(", "),
                })}
              </p>
            )}
            {comparability.onlyInPost.length > 0 && (
              <p className="mt-1">
                {t("organizationMetrics.courseAssessment.onlyInPost", {
                  list: comparability.onlyInPost.join(", "),
                })}
              </p>
            )}
          </div>
        )}

        <table className="w-full text-left text-sm text-typography-800">
          <thead>
            <tr className="border-b border-solid border-border-light text-typography-600">
              <th className="py-2 pr-3 font-medium">
                {t("organizationMetrics.courseAssessment.columns.learner")}
              </th>
              <th className="py-2 pr-3 font-medium">
                {t("organizationMetrics.courseAssessment.columns.pre")}
              </th>
              <th className="py-2 pr-3 font-medium">
                {t("organizationMetrics.courseAssessment.columns.post")}
              </th>
              <th className="py-2 pr-3 font-medium">
                {t("organizationMetrics.courseAssessment.columns.gain")}
              </th>
              <th className="py-2 font-medium">
                {t("organizationMetrics.courseAssessment.columns.incompleteStarts")}
              </th>
            </tr>
          </thead>
          <tbody>
            {pair.learners.map(learner => (
              <tr
                key={learner.userId}
                className="border-b border-solid border-border-light last:border-0"
                data-testid="assessment-learner-row"
              >
                <td className="py-2 pr-3 align-top">{learner.name}</td>
                {renderSide(learner.pre, "assessment-pre")}
                {renderSide(learner.post, "assessment-post")}
                <td className="py-2 pr-3 align-top">{formatGain(learner.gain)}</td>
                <td className="py-2 align-top">
                  {(learner.pre?.incompleteStarts ?? 0) + (learner.post?.incompleteStarts ?? 0)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    );
  };

  const renderBody = () => {
    if (isLoading) {
      return (
        <div className="flex justify-center py-12" data-testid="course-assessment-loading">
          <Loading withOverlay={false} />
        </div>
      );
    }
    if (isError) {
      return (
        <ActionableNotification
          kind="error"
          lowContrast
          hideCloseButton
          inline
          title={t("organizationMetrics.courseAssessment.errorTitle")}
          subtitle={t("organizationMetrics.courseAssessment.errorSubtitle")}
          actionButtonLabel={t("organizationMetrics.states.retry")}
          onActionButtonClick={() => refetch()}
        />
      );
    }
    if (!data || data.pairs.length === 0) {
      return (
        <p className="text-sm text-typography-600" data-testid="course-assessment-empty">
          {t("organizationMetrics.courseAssessment.empty")}
        </p>
      );
    }
    return <div className="flex flex-col gap-8">{data.pairs.map(renderPair)}</div>;
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={`${t("organizationMetrics.courseAssessment.title")} · ${courseTitle}`}
      drawerClassName="w-[50vw] min-w-[480px]"
      bodyClassName="p-4"
    >
      {renderBody()}
    </Drawer>
  );
};

export default CourseAssessmentDrawer;
