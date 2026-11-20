import { FC } from "react";

import { Link, Navigate, useParams } from "react-router-dom";

import { ROUTES } from "@constants";

import { LandingCopy } from "./landingCopy";
import { isSectionKey, PLACEHOLDER_ITEM_COUNT } from "./sections";
import { usePageMeta } from "../blog/usePageMeta";

interface LandingSectionProps {
  copy: LandingCopy;
}

/**
 * One block's own page: breadcrumbs, the block's name and intro, and a
 * placeholder list. An unknown section goes back to the landing page.
 */
export const LandingSection: FC<LandingSectionProps> = ({ copy }) => {
  const { section } = useParams();

  if (!isSectionKey(section)) {
    return <Navigate to={ROUTES.LANDING_PAGE_1} replace />;
  }

  return <SectionPage copy={copy} section={section} />;
};

const SectionPage: FC<{ copy: LandingCopy; section: keyof LandingCopy["items"] }> = ({
  copy,
  section,
}) => {
  const details = copy[section];

  usePageMeta({
    title: `${details.name} · ${copy.heading}`,
    description: details.body,
    url: `${ROUTES.LANDING_PAGE_1}/${section}`,
  });

  return (
    <main className="lp1-main lp1-section">
      <nav className="lp1-crumbs" aria-label={copy.breadcrumbLabel}>
        <ol>
          <li>
            <Link to={ROUTES.LANDING_PAGE_1}>{copy.breadcrumbHome}</Link>
          </li>
          <li aria-current="page">{details.name}</li>
        </ol>
      </nav>

      <header className="lp1-section-head">
        <h1>{details.name}</h1>
        <p>{details.body}</p>
      </header>

      <ul className="lp1-items">
        {Array.from({ length: PLACEHOLDER_ITEM_COUNT[section] }, (_, index) => (
          <li key={index} className="lp1-item">
            <span className="lp1-item-name">{`${copy.items[section]} ${index + 1}`}</span>
            <span className="lp1-item-body">{copy.itemDescription}</span>
          </li>
        ))}
      </ul>
    </main>
  );
};
