import { FunctionComponent, useState } from "react";

import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { ActionableNotification, Loading } from "@ally-ui-mono/ui-shared";
import { useGetLearnerEnrollmentsQuery, useRemoveLearnerEnrollmentMutation } from "@api";
import { Button, ButtonVariant, Drawer } from "@components";
import { LearnerEnrollment } from "@types";

interface LearnerCoursesDrawerProps {
  open: boolean;
  onClose: () => void;
  userId: number;
  learnerName: string;
}

const KNOWN_DENIALS = new Set(["NOT_IN_GROUP", "NOT_IN_ORGANIZATION", "NOT_AVAILABLE"]);

const formatDate = (value: string | null | undefined): string =>
  value ? new Date(value).toLocaleDateString("en-US", { dateStyle: "medium" }) : "";

/**
 * Trainer view of the courses one learner is enrolled in, with the action
 * that removes them from one. A learner keeps a course they enrolled in even
 * after their group loses it, so each row says when the enrolment is the only
 * reason the course is in their list — usually the row the trainer came for.
 * Removing is confirmed in place, like reopening attempts, and the wording
 * depends on whether the course would come back as a fresh start.
 */
export const LearnerCoursesDrawer: FunctionComponent<LearnerCoursesDrawerProps> = ({
  open,
  onClose,
  userId,
  learnerName,
}) => {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState<LearnerEnrollment | null>(null);

  const { data, isLoading, isError, refetch } = useGetLearnerEnrollmentsQuery(userId, {
    skip: !open,
  });
  const [removeEnrollment, { isLoading: isRemoving }] = useRemoveLearnerEnrollmentMutation();

  const handleClose = () => {
    setConfirming(null);
    onClose();
  };

  const handleConfirm = async () => {
    if (!confirming) return;
    try {
      await removeEnrollment({ userId, trackEnrollmentId: confirming.trackEnrollmentId }).unwrap();
      toast.success(t("organizationMetrics.learnerCourses.removeSuccess"));
      setConfirming(null);
    } catch (err) {
      const message = (err as { data?: { message?: string } })?.data?.message;
      toast.error(message || t("organizationMetrics.learnerCourses.removeError"));
    }
  };

  const denialLabel = (denial: string) =>
    t(
      KNOWN_DENIALS.has(denial)
        ? `organizationMetrics.learnerCourses.denial.${denial}`
        : "organizationMetrics.learnerCourses.denial.other",
    );

  const renderBody = () => {
    if (isLoading) {
      return (
        <div className="flex justify-center py-12" data-testid="learner-courses-loading">
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
          title={t("organizationMetrics.learnerCourses.errorTitle")}
          subtitle={t("organizationMetrics.learnerCourses.errorSubtitle")}
          actionButtonLabel={t("organizationMetrics.states.retry")}
          onActionButtonClick={() => refetch()}
        />
      );
    }
    if (!data || data.length === 0) {
      return (
        <p className="text-sm text-typography-600" data-testid="learner-courses-empty">
          {t("organizationMetrics.learnerCourses.empty")}
        </p>
      );
    }
    return (
      <ul className="flex flex-col gap-3">
        {data.map(enrollment => (
          <li
            key={enrollment.trackEnrollmentId}
            className="border border-solid border-border-light rounded p-3 flex flex-col gap-2"
            data-testid="learner-courses-row"
          >
            <div className="text-sm font-medium text-typography-800">{enrollment.trackTitle}</div>
            <div className="text-sm text-typography-600">
              {enrollment.completedAt
                ? t("organizationMetrics.learnerCourses.completedOn", {
                    when: formatDate(enrollment.completedAt),
                  })
                : t("organizationMetrics.learnerCourses.progress", {
                    completed: enrollment.completedItems,
                    total: enrollment.totalItems,
                  })}
              {" · "}
              {t("organizationMetrics.learnerCourses.enrolledOn", {
                when: formatDate(enrollment.enrolledAt),
              })}
            </div>
            {enrollment.accessDenial && (
              <div className="text-sm text-typography-800" data-testid="learner-courses-denial">
                <span className="font-medium">{denialLabel(enrollment.accessDenial)}</span>
                {" · "}
                {t("organizationMetrics.learnerCourses.enrolmentOnlyHint")}
              </div>
            )}
            {confirming?.trackEnrollmentId === enrollment.trackEnrollmentId ? (
              <div className="flex flex-col gap-2" data-testid="learner-courses-confirm">
                <p className="text-sm text-typography-800">
                  {t(
                    enrollment.accessDenial
                      ? "organizationMetrics.learnerCourses.confirmHidden"
                      : "organizationMetrics.learnerCourses.confirmOpen",
                    { name: learnerName, course: enrollment.trackTitle },
                  )}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant={ButtonVariant.DESTRUCTIVE}
                    onClick={handleConfirm}
                    disabled={isRemoving}
                  >
                    {t("organizationMetrics.learnerCourses.confirmButton")}
                  </Button>
                  <Button
                    variant={ButtonVariant.SECONDARY}
                    onClick={() => setConfirming(null)}
                    disabled={isRemoving}
                  >
                    {t("organizationMetrics.learnerCourses.cancel")}
                  </Button>
                </div>
              </div>
            ) : (
              <div>
                <Button variant={ButtonVariant.SECONDARY} onClick={() => setConfirming(enrollment)}>
                  {t("organizationMetrics.learnerCourses.remove")}
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    );
  };

  return (
    <Drawer
      open={open}
      onClose={handleClose}
      title={t("organizationMetrics.learnerCourses.title", { name: learnerName })}
      drawerClassName="w-[40vw] min-w-[400px]"
      bodyClassName="p-4"
    >
      {renderBody()}
    </Drawer>
  );
};

export default LearnerCoursesDrawer;
