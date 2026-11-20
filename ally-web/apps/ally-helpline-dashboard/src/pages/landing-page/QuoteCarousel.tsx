import { FC, useCallback, useRef, useState } from "react";

export interface QuoteSlide {
  quote: string;
  name: string;
  role: string;
}

interface QuoteCarouselProps {
  slides: QuoteSlide[];
  label: string;
  previousLabel: string;
  nextLabel: string;
  /** Builds the accessible name of a dot, e.g. "Go to quote 2". */
  goToLabel: (position: number) => string;
}

/**
 * Swipeable quote slider. A scroll-snap track, so a phone swipes it natively,
 * with previous/next buttons and dots for everyone else. It never advances on
 * its own: on a page about suicide prevention, text that moves while someone
 * is reading it is the wrong default.
 */
export const QuoteCarousel: FC<QuoteCarouselProps> = ({
  slides,
  label,
  previousLabel,
  nextLabel,
  goToLabel,
}) => {
  const trackRef = useRef<HTMLUListElement>(null);
  const [active, setActive] = useState(0);

  const goTo = useCallback(
    (index: number) => {
      const track = trackRef.current;
      const clamped = Math.max(0, Math.min(slides.length - 1, index));
      setActive(clamped);
      track?.scrollTo?.({ left: clamped * track.clientWidth, behavior: "smooth" });
    },
    [slides.length],
  );

  const onScroll = () => {
    const track = trackRef.current;
    if (!track || !track.clientWidth) return;
    setActive(Math.round(track.scrollLeft / track.clientWidth));
  };

  return (
    <section className="lp1-quotes" aria-roledescription="carousel" aria-label={label}>
      <ul className="lp1-quotes-track" ref={trackRef} onScroll={onScroll}>
        {slides.map((slide, index) => (
          <li
            key={`${slide.name}-${index}`}
            className="lp1-quote"
            aria-roledescription="slide"
            aria-label={`${index + 1} / ${slides.length}`}
          >
            <blockquote>
              <p>{slide.quote}</p>
              <footer>
                <span className="lp1-quote-avatar" aria-hidden="true" />
                <span className="lp1-quote-who">
                  <span className="lp1-quote-name">{slide.name}</span>
                  <span className="lp1-quote-role">{slide.role}</span>
                </span>
              </footer>
            </blockquote>
          </li>
        ))}
      </ul>
      <div className="lp1-quotes-controls">
        <button
          type="button"
          className="lp1-quotes-arrow"
          aria-label={previousLabel}
          disabled={active === 0}
          onClick={() => goTo(active - 1)}
        >
          ‹
        </button>
        <div className="lp1-quotes-dots">
          {slides.map((slide, index) => (
            <button
              key={`${slide.name}-dot-${index}`}
              type="button"
              className={index === active ? "is-on" : ""}
              aria-label={goToLabel(index + 1)}
              aria-current={index === active}
              onClick={() => goTo(index)}
            />
          ))}
        </div>
        <button
          type="button"
          className="lp1-quotes-arrow"
          aria-label={nextLabel}
          disabled={active === slides.length - 1}
          onClick={() => goTo(active + 1)}
        >
          ›
        </button>
      </div>
    </section>
  );
};
