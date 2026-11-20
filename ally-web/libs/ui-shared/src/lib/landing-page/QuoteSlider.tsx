import { FC, useCallback, useRef, useState } from "react";

import { Block } from "./BlockControls";
import { cloneConfig, withText } from "./edit";
import { EditableImage } from "./EditableImage";
import { EditableText } from "./EditableText";
import { LANDING_CHROME, LANGUAGE_NAMES_EN, pickText } from "./languages";
import {
  LandingImageUploader,
  LandingLanguage,
  LandingQuoteSlide,
  LANDING_PAGE_LIMITS,
} from "./types";

interface QuoteSliderProps {
  enabled: boolean;
  slides: LandingQuoteSlide[];
  language: LandingLanguage;
  defaultLanguage: LandingLanguage;
  editable: boolean;
  onToggle: (next: boolean) => void;
  onSlidesChange: (next: LandingQuoteSlide[]) => void;
  onUpload?: LandingImageUploader;
}

const blankSlide = (): LandingQuoteSlide => ({ quote: {}, name: {}, role: {}, photoUrl: null });

/**
 * The quote slider. A scroll-snap track, so a phone swipes it natively, with
 * arrows and dots for everyone else. It never advances on its own: on a page
 * about suicide prevention, text that moves while someone reads it is the wrong
 * default. While editing, each slide's text and photo are edited where they
 * stand, and slides can be added or removed.
 */
export const QuoteSlider: FC<QuoteSliderProps> = ({
  enabled,
  slides,
  language,
  defaultLanguage,
  editable,
  onToggle,
  onSlidesChange,
  onUpload,
}) => {
  const chrome = LANDING_CHROME[language];
  const languageName = LANGUAGE_NAMES_EN[language];
  const track = useRef<HTMLUListElement | null>(null);
  const [active, setActive] = useState(0);

  const goTo = useCallback(
    (index: number) => {
      const element = track.current;
      const clamped = Math.max(0, Math.min(slides.length - 1, index));
      setActive(clamped);
      element?.scrollTo?.({ left: clamped * element.clientWidth, behavior: "smooth" });
    },
    [slides.length],
  );

  const onScroll = () => {
    const element = track.current;
    if (element?.clientWidth) setActive(Math.round(element.scrollLeft / element.clientWidth));
  };

  const edit = (index: number, change: (slide: LandingQuoteSlide) => void) => {
    const next = cloneConfig(slides);
    change(next[index]);
    onSlidesChange(next);
  };

  if (!editable && (!enabled || slides.length === 0)) return null;

  return (
    <Block label="Quote slider" enabled={enabled} editable={editable} onToggle={onToggle}>
      <section className="lp-quotes" aria-roledescription="carousel" aria-label={chrome.options}>
        {slides.length === 0 && editable && (
          <p className="lp-block-note">No quotes yet. Add the first one below.</p>
        )}
        <ul className="lp-quotes-track" ref={track} onScroll={onScroll}>
          {slides.map((slide, index) => (
            <li
              key={index}
              className="lp-quote"
              aria-roledescription="slide"
              aria-label={`${index + 1} / ${slides.length}`}
            >
              <blockquote>
                {editable && (
                  <button
                    type="button"
                    className="lp-remove"
                    aria-label={`Remove quote ${index + 1}`}
                    title="Remove this quote"
                    onClick={() => onSlidesChange(slides.filter((_, at) => at !== index))}
                  >
                    ×
                  </button>
                )}
                <EditableText
                  tag="p"
                  multiline
                  editable={editable}
                  value={
                    editable
                      ? (slide.quote[language] ?? "")
                      : pickText(slide.quote, language, defaultLanguage)
                  }
                  placeholder={`Add the quote in ${languageName}`}
                  onChange={value =>
                    edit(index, item => (item.quote = withText(item.quote, language, value)))
                  }
                />
                <footer>
                  <EditableImage
                    className="lp-quote-avatar"
                    imageClassName="lp-quote-photo"
                    src={slide.photoUrl}
                    alt={pickText(slide.name, language, defaultLanguage)}
                    editable={editable}
                    emptyLabel="Add a photo"
                    onUpload={onUpload}
                    onChange={photoUrl => edit(index, item => (item.photoUrl = photoUrl))}
                  />
                  {!editable && !slide.photoUrl && (
                    <span className="lp-quote-avatar is-blank" aria-hidden="true" />
                  )}
                  <span className="lp-quote-who">
                    <EditableText
                      className="lp-quote-name"
                      editable={editable}
                      value={
                        editable
                          ? (slide.name[language] ?? "")
                          : pickText(slide.name, language, defaultLanguage)
                      }
                      placeholder="Name"
                      onChange={value =>
                        edit(index, item => (item.name = withText(item.name, language, value)))
                      }
                    />
                    <EditableText
                      className="lp-quote-role"
                      editable={editable}
                      value={
                        editable
                          ? (slide.role[language] ?? "")
                          : pickText(slide.role, language, defaultLanguage)
                      }
                      placeholder="Role"
                      onChange={value =>
                        edit(index, item => (item.role = withText(item.role, language, value)))
                      }
                    />
                  </span>
                </footer>
              </blockquote>
            </li>
          ))}
        </ul>

        {slides.length > 1 && (
          <div className="lp-quotes-controls">
            <button
              type="button"
              className="lp-quotes-arrow"
              aria-label={chrome.previousQuote}
              disabled={active === 0}
              onClick={() => goTo(active - 1)}
            >
              ‹
            </button>
            <div className="lp-quotes-dots">
              {slides.map((_, index) => (
                <button
                  key={index}
                  type="button"
                  className={index === active ? "is-on" : ""}
                  aria-label={chrome.goToQuote.replace("{n}", String(index + 1))}
                  aria-current={index === active}
                  onClick={() => goTo(index)}
                />
              ))}
            </div>
            <button
              type="button"
              className="lp-quotes-arrow"
              aria-label={chrome.nextQuote}
              disabled={active === slides.length - 1}
              onClick={() => goTo(active + 1)}
            >
              ›
            </button>
          </div>
        )}

        {editable && slides.length < LANDING_PAGE_LIMITS.SLIDES && (
          <button
            type="button"
            className="lp-add"
            onClick={() => {
              onSlidesChange([...slides, blankSlide()]);
              setTimeout(() => goTo(slides.length), 0);
            }}
          >
            + Add a quote
          </button>
        )}
      </section>
    </Block>
  );
};
