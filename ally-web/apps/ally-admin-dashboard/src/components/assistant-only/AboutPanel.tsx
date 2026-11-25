import React, { useRef, useState } from "react";

import { en } from "@constants";

const t = en.assistantsShell.cornerMenu.aboutPanel;
const features = en.assistantsShell.login.capabilities;

const Chevron: React.FC<{ dir: "left" | "right" }> = ({ dir }) => (
  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="currentColor">
    <path
      d={
        dir === "left" ? "M10 13 5 8l5-5 .7.7L6.4 8l4.3 4.3z" : "M6 3l5 5-5 5-.7-.7L9.6 8 5.3 3.7z"
      }
    />
  </svg>
);

/**
 * One feature at a time, swiped or stepped with the arrows. A scroll-snap track, so touch and
 * trackpad swipes work without script; the arrows and the count follow the same position. No
 * autoplay. The slides that are not showing are hidden from screen readers.
 */
const FeatureCarousel: React.FC = () => {
  const items = features.items;
  const track = useRef<HTMLUListElement>(null);
  const [index, setIndex] = useState(0);
  const go = (next: number) => {
    const i = Math.max(0, Math.min(items.length - 1, next));
    setIndex(i);
    const el = track.current;
    if (el && typeof el.scrollTo === "function") {
      el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
    }
  };
  const onScroll = () => {
    const el = track.current;
    if (!el || !el.clientWidth) return;
    const i = Math.round(el.scrollLeft / el.clientWidth);
    if (i !== index && i >= 0 && i < items.length) setIndex(i);
  };
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowRight") go(index + 1);
    else if (event.key === "ArrowLeft") go(index - 1);
    else return;
    event.preventDefault();
  };
  return (
    <div
      className="corner-about__carousel"
      role="group"
      aria-roledescription="carousel"
      aria-label={t.carouselLabel}
      onKeyDown={onKeyDown}
      data-testid="corner-about-carousel"
    >
      <ul ref={track} className="corner-about__track" onScroll={onScroll}>
        {items.map((item, i) => (
          <li
            key={item.id}
            className="corner-about__slide"
            role="group"
            aria-roledescription="slide"
            aria-label={t.position(i + 1, items.length)}
            aria-hidden={i === index ? undefined : true}
            data-testid="corner-about-feature"
          >
            <strong>{item.title}</strong>
            <span>{item.blurb}</span>
          </li>
        ))}
      </ul>
      <div className="corner-about__controls">
        <span className="corner-about__count" aria-live="polite" data-testid="corner-about-count">
          {t.position(index + 1, items.length)}
        </span>
        <div className="corner-about__arrows">
          <button
            type="button"
            aria-label={t.previous}
            disabled={index === 0}
            onClick={() => go(index - 1)}
            data-testid="corner-about-prev"
          >
            <Chevron dir="left" />
          </button>
          <button
            type="button"
            aria-label={t.next}
            disabled={index === items.length - 1}
            onClick={() => go(index + 1)}
            data-testid="corner-about-next"
          >
            <Chevron dir="right" />
          </button>
        </div>
      </div>
    </div>
  );
};

/**
 * The drawer's About tab: what Ally Chatbots is, how it works, what a builder can control and who
 * does what. The feature carousel is the sign-in page's own list, so the two never disagree.
 * Drawn on the Carbon tokens (`corner-drawer.css`): flat tiles, Plex Serif, no radii.
 */
export const AboutPanel: React.FC = () => (
  <div className="ally-v2 corner-about" data-testid="corner-menu-about">
    <section className="corner-about__hero">
      <p className="corner-about__eyebrow">{t.eyebrow}</p>
      <h3 className="corner-about__title">{t.title}</h3>
      <p className="corner-about__intro">{t.intro}</p>
    </section>

    <section aria-labelledby="corner-about-steps">
      <h4 id="corner-about-steps" className="corner-about__heading">
        {t.stepsHeading}
      </h4>
      <ol className="corner-about__steps">
        {t.steps.map((step, index) => (
          <li key={step.title} className="corner-about__tile">
            <span className="corner-about__num" aria-hidden="true">
              {index + 1}
            </span>
            <strong>{step.title}</strong>
            <span>{step.blurb}</span>
          </li>
        ))}
      </ol>
    </section>

    <section aria-labelledby="corner-about-features">
      <h4 id="corner-about-features" className="corner-about__heading">
        {t.featuresHeading}
      </h4>
      <FeatureCarousel />
    </section>

    <section aria-labelledby="corner-about-roles">
      <h4 id="corner-about-roles" className="corner-about__heading">
        {t.rolesHeading}
      </h4>
      <ul className="corner-about__roles">
        {t.roles.map(role => (
          <li key={role.title}>
            <strong>{role.title}</strong>
            <span>{role.blurb}</span>
          </li>
        ))}
      </ul>
    </section>
  </div>
);
