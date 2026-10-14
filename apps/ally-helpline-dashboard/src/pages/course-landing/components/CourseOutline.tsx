import { FC } from "react";

import { useTranslation } from "react-i18next";

import { TrackTypeIcon, getTrackItemMeta } from "@components";
import { PublicTrackOutlineItem, PublicTrackOutlineSection, TrackDetailItem } from "@types";

/**
 * The meta line ("5 questions · pass 70%", "8 min video") reads only the
 * item's type and `contentMeta`, so a public item — which carries no progress
 * or completion rule — is widened to the learner shape it expects.
 */
const toMetaItem = (item: PublicTrackOutlineItem): TrackDetailItem =>
  ({ ...item, completionCriteria: null }) as unknown as TrackDetailItem;

interface CourseOutlineProps {
  sections: PublicTrackOutlineSection[];
}

/**
 * Read-only outline of a course for its public landing page: numbered
 * sections, each with its components on a connector line. Nothing is
 * clickable and nothing reads as "locked" — this is a preview of what the
 * course contains, not a journey the visitor has started.
 */
export const CourseOutline: FC<CourseOutlineProps> = ({ sections }) => {
  const { t } = useTranslation();
  const sorted = [...sections].sort((a, b) => a.order - b.order);

  return (
    <div className="pt-2" data-testid="course-outline">
      <h2 className="mb-3 text-lg font-semibold text-typography-900">
        {t("courseLanding.outlineTitle")}
      </h2>
      {sorted.map((section, sectionIndex) => {
        const items = [...section.items].sort((a, b) => a.order - b.order);
        return (
          <section key={section.id} aria-label={section.title} className="relative">
            <div className="flex items-center gap-3 py-2">
              <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border-2 border-primary-200 text-sm font-semibold text-typography-900">
                {sectionIndex + 1}
              </span>
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-typography-900 break-words">
                  {section.title}
                </h3>
                <p className="text-xs text-typography-700">
                  {section.description || t("courseLanding.sectionItems", { count: items.length })}
                </p>
              </div>
            </div>
            <ul className="relative ml-5 flex flex-col gap-2 border-l-2 border-border-light pb-5 pl-5 pt-1 sm:pl-7">
              {items.map(item => (
                <li
                  key={item.id}
                  className="flex items-center gap-3 rounded-[14px] border border-border-light bg-white p-3"
                >
                  <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-primary-50 text-primary-600">
                    <TrackTypeIcon type={item.type} />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-sm font-medium text-typography-900 break-words sm:text-base">
                      {item.title}
                    </span>
                    <span className="text-xs text-typography-700">
                      {getTrackItemMeta(toMetaItem(item), t)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
};
