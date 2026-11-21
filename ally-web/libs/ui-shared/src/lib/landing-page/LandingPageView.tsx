import { FC, MouseEvent, ReactNode } from "react";

import "./landing-page.css";

import { DropdownField } from "../dropdown-field";
import { Block } from "./BlockControls";
import { cloneConfig, withText } from "./edit";
import { EditableImage } from "./EditableImage";
import { EditableText } from "./EditableText";
import { LANDING_CHROME, LANGUAGE_LABELS, LANGUAGE_NAMES_EN, pickText } from "./languages";
import { LinkField } from "./LinkField";
import { QuoteSlider } from "./QuoteSlider";
import {
  LANDING_CARD_KEYS,
  LandingBranding,
  LandingCard,
  LandingCardKey,
  LandingImageUploader,
  LandingLanguage,
  LandingPageConfig,
  LANDING_PAGE_LIMITS,
} from "./types";
import { AllyLogo } from "../landing-page/AllyLogo";

export interface LandingPageViewProps {
  config: LandingPageConfig;
  branding: LandingBranding;
  language: LandingLanguage;
  onLanguageChange: (language: LandingLanguage) => void;
  /** Which block's own page is open, or null for the landing page. */
  section: LandingCardKey | null;
  onSectionChange: (section: LandingCardKey | null) => void;
  /** The draft with in-place controls. Off is the page exactly as visitors see it. */
  editable?: boolean;
  onConfigChange?: (next: LandingPageConfig) => void;
  onUploadImage?: LandingImageUploader;
  /** Opens the login panel. Left out where logging in makes no sense (the editor). */
  onLogIn?: () => void;
  /** Real addresses for the section links, so they can open in a new tab on the public site. */
  sectionHref?: (section: LandingCardKey | null) => string;
  /** Rendered after the page: the login panel and the like. */
  children?: ReactNode;
  /**
   * Make the page at least as tall as the screen, so the footer rests at the bottom of a
   * short page. The public site wants it; the editor, which has a toolbar above, does not.
   */
  fillScreen?: boolean;
}

/** A click that should open a new tab or window is left to the browser. */
const isPlainClick = (event: MouseEvent) =>
  event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;

/**
 * One landing page, drawn from its configuration in one of three templates.
 * The public site and the admin editor both render this component; the only
 * difference is `editable`, which turns every text into click-to-edit, gives
 * every image a hover cross and upload button, and lets each block be hidden.
 * Navigation between the landing page and a block's page is state the caller
 * owns, so the editor needs no router and the public site can use real URLs.
 */
export const LandingPageView: FC<LandingPageViewProps> = ({
  config,
  branding,
  language,
  onLanguageChange,
  section,
  onSectionChange,
  editable = false,
  onConfigChange,
  onUploadImage,
  onLogIn,
  sectionHref,
  children,
  fillScreen = false,
}) => {
  const chrome = LANDING_CHROME[language];
  const languageName = LANGUAGE_NAMES_EN[language];
  const defaultLanguage = config.languages.default;

  const change = (edit: (draft: LandingPageConfig) => void) => {
    if (!onConfigChange) return;
    const next = cloneConfig(config);
    edit(next);
    onConfigChange(next);
  };

  /** What this text shows: while editing, only this language; otherwise with the fallback. */
  const shown = (text: Partial<Record<LandingLanguage, string>> | undefined): string =>
    editable ? (text?.[language] ?? "") : pickText(text, language, defaultLanguage);

  const open = (event: MouseEvent, target: LandingCardKey | null) => {
    if (editable || isPlainClick(event)) event.preventDefault();
    if (editable || isPlainClick(event)) onSectionChange(target);
  };

  const card = (key: LandingCardKey): LandingCard =>
    config.cards.items.find(item => item.key === key) as LandingCard;

  const editCard = (key: LandingCardKey, edit: (card: LandingCard) => void) =>
    change(draft => edit(draft.cards.items.find(item => item.key === key) as LandingCard));

  // ---- header ----------------------------------------------------------------

  const tenantLogo = branding.logoUrl;
  const logoSrc = config.logo.source === "custom" ? config.logo.url : tenantLogo;
  const logoAlt = pickText(config.logo.alt, language, defaultLanguage) || branding.displayName;

  const header = (
    <header className="lp-top">
      <span className="lp-logo-slot">
        <EditableImage
          className="lp-logo"
          imageClassName="lp-logo-img"
          src={logoSrc}
          alt={logoAlt}
          editable={editable}
          emptyLabel={config.logo.source === "custom" ? "Add a logo" : "Upload a different logo"}
          removable={config.logo.source === "custom"}
          onUpload={onUploadImage}
          onChange={url =>
            change(draft => {
              draft.logo.source = url ? "custom" : "tenant";
              draft.logo.url = url;
            })
          }
        />
        {!logoSrc && <span className="lp-logo-name">{branding.displayName}</span>}
        {editable && logoSrc && config.logo.source === "tenant" && (
          <span className="lp-logo-hint">Organization logo</span>
        )}
      </span>
      <div className="lp-actions">
        <button type="button" className="lp-btn" onClick={onLogIn} disabled={!onLogIn && !editable}>
          {chrome.logIn}
        </button>
        {config.languages.enabled.length > 1 && (
          <div className="lp-lang" aria-label={chrome.language}>
            <DropdownField
              value={LANGUAGE_LABELS[language]}
              options={config.languages.enabled.map(code => LANGUAGE_LABELS[code])}
              onChange={label =>
                onLanguageChange(
                  config.languages.enabled.find(code => LANGUAGE_LABELS[code] === label) ??
                    defaultLanguage,
                )
              }
              valueClassName="text-sm font-medium"
              hideSearch
            />
          </div>
        )}
      </div>
    </header>
  );

  const helpline = (
    <Block
      label="Helpline line"
      enabled={config.helpline.enabled}
      editable={editable}
      onToggle={next => change(draft => (draft.helpline.enabled = next))}
      className="lp-helpline-wrap"
    >
      <div className="lp-helpline" role="note">
        <EditableText
          editable={editable}
          value={shown(config.helpline.text)}
          placeholder={`Add the helpline line in ${languageName}`}
          onChange={value =>
            change(draft => (draft.helpline.text = withText(draft.helpline.text, language, value)))
          }
        />
      </div>
    </Block>
  );

  // ---- landing page ------------------------------------------------------------

  const home = (
    <main className="lp-main lp-home">
      <section className="lp-hero">
        <div className="lp-hero-text">
          <EditableText
            tag="h1"
            editable={editable}
            value={shown(config.headings.first)}
            placeholder={`Add the first heading in ${languageName}`}
            onChange={value =>
              change(
                draft => (draft.headings.first = withText(draft.headings.first, language, value)),
              )
            }
          />
          <EditableText
            tag="p"
            className="lp-tagline"
            editable={editable}
            value={shown(config.headings.second)}
            placeholder={`Add the second heading in ${languageName}`}
            onChange={value =>
              change(
                draft => (draft.headings.second = withText(draft.headings.second, language, value)),
              )
            }
          />
          <EditableText
            tag="p"
            multiline
            className="lp-sub"
            editable={editable}
            value={shown(config.headings.third)}
            placeholder={`Add the third heading in ${languageName}`}
            onChange={value =>
              change(
                draft => (draft.headings.third = withText(draft.headings.third, language, value)),
              )
            }
          />
        </div>
        {(editable || (config.hero.enabled && config.hero.imageUrl)) && (
          <Block
            label="Hero image"
            enabled={config.hero.enabled}
            editable={editable}
            onToggle={next => change(draft => (draft.hero.enabled = next))}
            className="lp-hero-image"
          >
            <EditableImage
              imageClassName="lp-hero-img"
              src={config.hero.imageUrl}
              alt={pickText(config.hero.imageAlt, language, defaultLanguage)}
              editable={editable}
              emptyLabel="Add a hero image"
              onUpload={onUploadImage}
              onChange={url => change(draft => (draft.hero.imageUrl = url))}
            />
          </Block>
        )}
      </section>

      <div className="lp-slider-wrap">
        <QuoteSlider
          enabled={config.slider.enabled}
          slides={config.slider.slides}
          language={language}
          defaultLanguage={defaultLanguage}
          editable={editable}
          onToggle={next => change(draft => (draft.slider.enabled = next))}
          onSlidesChange={slides => change(draft => (draft.slider.slides = slides))}
          onUpload={onUploadImage}
        />
      </div>

      <div className="lp-cards-wrap">
        <Block
          label="Cards"
          enabled={config.cards.enabled}
          editable={editable}
          onToggle={next => change(draft => (draft.cards.enabled = next))}
        >
          <section className="lp-options" aria-label={chrome.options}>
            {LANDING_CARD_KEYS.map(key => {
              const item = card(key);
              if (!editable && !item.enabled) return null;
              const inner = (
                <>
                  <EditableText
                    className="lp-card-name"
                    editable={editable}
                    stopClick
                    value={shown(item.title)}
                    placeholder={`Add the card title in ${languageName}`}
                    onChange={value =>
                      editCard(
                        key,
                        target => (target.title = withText(target.title, language, value)),
                      )
                    }
                  />
                  <EditableText
                    className="lp-card-body"
                    multiline
                    editable={editable}
                    stopClick
                    value={shown(item.intro)}
                    placeholder={`Add a short intro in ${languageName}`}
                    onChange={value =>
                      editCard(
                        key,
                        target => (target.intro = withText(target.intro, language, value)),
                      )
                    }
                  />
                </>
              );
              if (editable) {
                return (
                  <div key={key} className={`lp-card ${item.enabled ? "" : "is-hidden"}`}>
                    {inner}
                    <span className="lp-card-tools">
                      <button
                        type="button"
                        className="lp-link-btn"
                        onClick={() => onSectionChange(key)}
                      >
                        Edit this page ›
                      </button>
                      <button
                        type="button"
                        className="lp-link-btn"
                        onClick={() => editCard(key, target => (target.enabled = !target.enabled))}
                      >
                        {item.enabled ? "Hide card" : "Show card"}
                      </button>
                    </span>
                  </div>
                );
              }
              return (
                <a
                  key={key}
                  className="lp-card"
                  href={sectionHref?.(key) ?? "#"}
                  onClick={event => open(event, key)}
                >
                  {inner}
                </a>
              );
            })}
          </section>
        </Block>
      </div>
    </main>
  );

  // ---- a block's own page ------------------------------------------------------

  const sectionPage = (key: LandingCardKey) => {
    const item = card(key);
    return (
      <main className="lp-main lp-section">
        <nav className="lp-crumbs" aria-label={chrome.breadcrumb}>
          <ol>
            <li>
              <a href={sectionHref?.(null) ?? "#"} onClick={event => open(event, null)}>
                {chrome.home}
              </a>
            </li>
            <li aria-current="page">{shown(item.title) || (editable ? "Untitled" : "")}</li>
          </ol>
        </nav>

        <header className="lp-section-head">
          <EditableText
            tag="h1"
            editable={editable}
            value={shown(item.title)}
            placeholder={`Add the page title in ${languageName}`}
            onChange={value =>
              editCard(key, target => (target.title = withText(target.title, language, value)))
            }
          />
          <EditableText
            tag="p"
            multiline
            editable={editable}
            value={shown(item.intro)}
            placeholder={`Add an intro in ${languageName}`}
            onChange={value =>
              editCard(key, target => (target.intro = withText(target.intro, language, value)))
            }
          />
        </header>

        <ul className="lp-items">
          {item.entries.map((entry, index) => {
            const body = (
              <>
                <EditableText
                  className="lp-item-name"
                  editable={editable}
                  stopClick
                  value={shown(entry.title)}
                  placeholder={`Add a title in ${languageName}`}
                  onChange={value =>
                    editCard(
                      key,
                      target =>
                        (target.entries[index].title = withText(
                          target.entries[index].title,
                          language,
                          value,
                        )),
                    )
                  }
                />
                <EditableText
                  className="lp-item-body"
                  multiline
                  editable={editable}
                  stopClick
                  value={shown(entry.description)}
                  placeholder={`Add a description in ${languageName}`}
                  onChange={value =>
                    editCard(
                      key,
                      target =>
                        (target.entries[index].description = withText(
                          target.entries[index].description,
                          language,
                          value,
                        )),
                    )
                  }
                />
              </>
            );
            return (
              <li key={index} className="lp-item">
                {editable ? (
                  <>
                    <button
                      type="button"
                      className="lp-remove"
                      aria-label={`Remove entry ${index + 1}`}
                      title="Remove this entry"
                      onClick={() => editCard(key, target => target.entries.splice(index, 1))}
                    >
                      ×
                    </button>
                    {body}
                    <LinkField
                      label="Link"
                      value={entry.linkUrl}
                      onChange={url =>
                        editCard(key, target => (target.entries[index].linkUrl = url))
                      }
                    />
                  </>
                ) : entry.linkUrl ? (
                  <a className="lp-item-link" href={entry.linkUrl}>
                    {body}
                  </a>
                ) : (
                  body
                )}
              </li>
            );
          })}
        </ul>

        {editable && item.entries.length < LANDING_PAGE_LIMITS.ENTRIES_PER_CARD && (
          <button
            type="button"
            className="lp-add"
            onClick={() =>
              editCard(key, target =>
                target.entries.push({ title: {}, description: {}, linkUrl: null }),
              )
            }
          >
            + Add an entry
          </button>
        )}
      </main>
    );
  };

  // ---- footer ------------------------------------------------------------------

  const footer = (
    <footer className="lp-foot">
      <Block
        label="Disclaimer"
        enabled={config.footer.disclaimer.enabled}
        editable={editable}
        onToggle={next => change(draft => (draft.footer.disclaimer.enabled = next))}
      >
        <EditableText
          tag="p"
          multiline
          className="lp-disclaimer"
          editable={editable}
          value={shown(config.footer.disclaimer.text)}
          placeholder={`Add the disclaimer in ${languageName}`}
          onChange={value =>
            change(
              draft =>
                (draft.footer.disclaimer.text = withText(
                  draft.footer.disclaimer.text,
                  language,
                  value,
                )),
            )
          }
        />
      </Block>

      <div className="lp-foot-logos">
        <div className="lp-foot-left">
          {editable && (
            <span className="lp-foot-switches">
              <label>
                <input
                  type="checkbox"
                  checked={config.footer.showAllyLogo}
                  onChange={event =>
                    change(draft => (draft.footer.showAllyLogo = event.target.checked))
                  }
                />
                Ally logo
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={config.footer.showTenantLogo}
                  onChange={event =>
                    change(draft => (draft.footer.showTenantLogo = event.target.checked))
                  }
                />
                Organization logo
              </label>
            </span>
          )}
          {config.footer.showTenantLogo && tenantLogo && (
            <img className="lp-foot-tenant" src={tenantLogo} alt={branding.displayName} />
          )}
          {config.footer.showAllyLogo && <AllyLogo className="lp-foot-ally" />}
        </div>

        <div className="lp-foot-right">
          {config.footer.partners.map((partner, index) => (
            <span key={index} className="lp-partner">
              {editable ? (
                <>
                  <EditableImage
                    imageClassName="lp-foot-partner"
                    src={partner.logoUrl}
                    alt={partner.name}
                    editable
                    emptyLabel={partner.name || "Partner logo"}
                    onUpload={onUploadImage}
                    onChange={url =>
                      change(draft => {
                        if (url) draft.footer.partners[index].logoUrl = url;
                        else draft.footer.partners.splice(index, 1);
                      })
                    }
                  />
                  <EditableText
                    className="lp-partner-name"
                    editable
                    value={partner.name}
                    placeholder="Partner name"
                    onChange={value => change(draft => (draft.footer.partners[index].name = value))}
                  />
                  <LinkField
                    label="Link"
                    value={partner.linkUrl}
                    onChange={url => change(draft => (draft.footer.partners[index].linkUrl = url))}
                  />
                </>
              ) : partner.linkUrl ? (
                <a href={partner.linkUrl} target="_blank" rel="noreferrer">
                  <img className="lp-foot-partner" src={partner.logoUrl} alt={partner.name} />
                </a>
              ) : (
                <img className="lp-foot-partner" src={partner.logoUrl} alt={partner.name} />
              )}
            </span>
          ))}
          {editable && config.footer.partners.length < LANDING_PAGE_LIMITS.PARTNERS && (
            <EditableImage
              src={null}
              alt=""
              editable
              emptyLabel="+ Add a partner logo"
              onUpload={onUploadImage}
              onChange={url => {
                if (url) {
                  change(draft =>
                    draft.footer.partners.push({ name: "", logoUrl: url, linkUrl: null }),
                  );
                }
              }}
            />
          )}
        </div>
      </div>
    </footer>
  );

  return (
    <div
      className="lp"
      lang={language}
      data-template={config.template}
      data-editing={editable ? "true" : "false"}
      data-fill={fillScreen ? "true" : "false"}
    >
      {header}
      {helpline}
      {section ? sectionPage(section) : home}
      {footer}
      {children}
    </div>
  );
};
