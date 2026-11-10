import React, { useId, useState } from "react";

import { Button } from "@components/v2";
import type { WidgetSettings } from "@types";

import { fill } from "../../Onboarding/copy";
import { HOME } from "../copy";
import { Collapsed, Group } from "../fields";

import type { HomeField } from "../useHomeField";

const t = HOME.website;
const API_ORIGIN = (() => {
  try {
    return new URL(import.meta.env.VITE_API_BASE_URL ?? "").origin;
  } catch {
    return "";
  }
})();

/** The line an owner pastes into their site (chunk 13): the loader on the bot page's own origin. */
export const widgetSnippet = (pageLink: string, slug: string): string =>
  `<script src="${new URL(pageLink).origin}/widget.js" data-assistant="${slug}" async></script>`;

/**
 * On your website (chunk 13): the line to copy, the websites where the bubble may appear, and how
 * it looks. A website is added with Add (not as you type, since a half-typed address isn't one);
 * ally-be normalises it and refuses shared hosts with a reason, shown under the list.
 */
export const WebsiteGroup: React.FC<{
  field: HomeField<WidgetSettings>;
  slug: string;
  pageLink: string;
  publicAllowed: boolean;
  disabled: boolean;
}> = ({ field, slug, pageLink, publicAllowed, disabled }) => {
  const id = useId();
  const [copied, setCopied] = useState(false);
  const [draft, setDraft] = useState("");
  const value = field.value;
  const set = (patch: Partial<WidgetSettings>, now = false) =>
    field.set({ ...value, ...patch }, { now });
  const snippet = widgetSnippet(pageLink, slug);
  const seconds = value.autoOpenSeconds ?? 10;

  const copy = () => {
    void navigator.clipboard?.writeText(snippet).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  const add = () => {
    const domain = draft.trim();
    if (!domain) return;
    set({ allowedDomains: [...value.allowedDomains, domain] }, true);
    setDraft("");
  };

  return (
    <Group title={t.title} hint={t.body} testId="share-website">
      <div className="ally-home__snippet">
        <code id={`${id}-snippet`}>{snippet}</code>
        <Button onClick={copy} aria-describedby={`${id}-snippet`}>
          {copied ? t.copied : t.copy}
        </Button>
      </div>
      {!publicAllowed && <p className="ally-field__hint">{t.publicNote}</p>}

      <fieldset className="ally-field" disabled={disabled} aria-describedby={`${id}-hint`}>
        <legend className="ally-field__label">{t.allowed}</legend>
        <span id={`${id}-hint`} className="ally-field__hint">
          {t.allowedHint}
        </span>
        {value.allowedDomains.length ? (
          <ul className="ally-home__domains">
            {value.allowedDomains.map(domain => (
              <li key={domain}>
                <span>{domain}</span>
                <button
                  type="button"
                  className="ally-link"
                  aria-label={`${t.remove}: ${domain}`}
                  onClick={() =>
                    set({ allowedDomains: value.allowedDomains.filter(d => d !== domain) }, true)
                  }
                >
                  {t.remove}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="ally-field__hint">{t.none}</p>
        )}
        <div className="ally-home__line">
          <input
            className="ally-input"
            aria-label={t.address}
            placeholder="yourclinic.in"
            value={draft}
            maxLength={253}
            onChange={event => setDraft(event.target.value)}
            onKeyDown={event => {
              if (event.key === "Enter") {
                event.preventDefault();
                add();
              }
            }}
          />
          <Button onClick={add} disabled={!draft.trim()}>
            {t.add}
          </Button>
        </div>
      </fieldset>

      <fieldset className="ally-field" disabled={disabled}>
        <legend className="ally-field__label">{t.position}</legend>
        <div className="ally-home__days">
          {(["right", "left"] as const).map(side => (
            <label key={side} className="ally-home__check">
              <input
                type="radio"
                name={`${id}-position`}
                checked={value.position === side}
                onChange={() => set({ position: side }, true)}
              />{" "}
              {side === "right" ? t.right : t.left}
            </label>
          ))}
        </div>
      </fieldset>

      <label className="ally-field">
        <span className="ally-field__label">{t.label}</span>
        <input
          className="ally-input"
          value={value.label}
          maxLength={24}
          disabled={disabled}
          onChange={event => set({ label: event.target.value })}
          onBlur={field.flush}
        />
      </label>

      <div className="ally-home__times">
        <label className="ally-home__check">
          <input
            type="checkbox"
            checked={value.autoOpenSeconds !== null}
            disabled={disabled}
            onChange={event =>
              set({ autoOpenSeconds: event.target.checked ? seconds : null }, true)
            }
          />{" "}
          {fill(t.openAfter, { n: seconds })}
        </label>
        {value.autoOpenSeconds !== null && (
          <input
            type="number"
            className="ally-input"
            aria-label={t.seconds}
            min={3}
            max={120}
            value={value.autoOpenSeconds}
            disabled={disabled}
            onChange={event => set({ autoOpenSeconds: Number(event.target.value) })}
            onBlur={field.flush}
          />
        )}
      </div>

      <label className="ally-home__check">
        <input
          type="checkbox"
          checked={value.showOnPhones}
          disabled={disabled}
          onChange={event => set({ showOnPhones: event.target.checked }, true)}
        />{" "}
        {t.phones}
      </label>

      {field.error && (
        <p className="ally-error" role="alert">
          {field.error}
        </p>
      )}

      <Collapsed summary={t.help.wordpress}>
        <p className="ally-body">{t.help.wordpressBody}</p>
      </Collapsed>
      <Collapsed summary={t.help.wix}>
        <p className="ally-body">{t.help.wixBody}</p>
      </Collapsed>
      <Collapsed summary={t.help.shopify}>
        <p className="ally-body">{t.help.shopifyBody}</p>
      </Collapsed>
      <Collapsed summary={t.help.any}>
        <p className="ally-body">{t.help.anyBody}</p>
        <p className="ally-body">
          {fill(t.help.csp, {
            scriptOrigin: new URL(pageLink).origin,
            apiOrigin: API_ORIGIN || new URL(pageLink).origin,
          })}
        </p>
      </Collapsed>
    </Group>
  );
};
