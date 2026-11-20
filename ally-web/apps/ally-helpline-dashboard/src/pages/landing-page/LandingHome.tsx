import { FC } from "react";

import { Link } from "react-router-dom";

import { ROUTES } from "@constants";

import { LandingCopy } from "./landingCopy";
import { QuoteCarousel } from "./QuoteCarousel";
import { SECTION_KEYS, sectionPath } from "./sections";
import { usePageMeta } from "../blog/usePageMeta";

interface LandingHomeProps {
  copy: LandingCopy;
}

/** The landing page itself: heading, quotes, and a card for each section. */
export const LandingHome: FC<LandingHomeProps> = ({ copy }) => {
  usePageMeta({ title: copy.title, description: copy.description, url: ROUTES.LANDING_PAGE_1 });

  return (
    <main className="lp1-main">
      <section className="lp1-hero">
        <h1>{copy.heading}</h1>
        <p className="lp1-tagline">{copy.tagline}</p>
        <p className="lp1-sub">{copy.sub}</p>
      </section>

      <QuoteCarousel
        slides={copy.quotes}
        label={copy.quotesLabel}
        previousLabel={copy.quotesPrevious}
        nextLabel={copy.quotesNext}
        goToLabel={position => copy.quotesGoTo.replace("{n}", String(position))}
      />

      <section className="lp1-options" aria-label="Options">
        {SECTION_KEYS.map(key => (
          <Link key={key} to={sectionPath(key)} className="lp1-card">
            <span className="lp1-card-name">{copy[key].name}</span>
            <span className="lp1-card-body">{copy[key].body}</span>
            <span className="lp1-card-count">{copy[key].count}</span>
          </Link>
        ))}
      </section>
    </main>
  );
};
