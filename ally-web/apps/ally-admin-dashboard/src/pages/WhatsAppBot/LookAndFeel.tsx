import React, { useEffect, useId, useState } from "react";

import { useGetBotPageQuery, useUpdateBotPageBrandMutation } from "@api";
import { ColourPicker, ImageSlot, PhonePreview, Toast } from "@components/v2";
import type { Chatbot } from "@types";

import { BrandEditor, useBrandEditor } from "../../hooks/brand/useBrandEditor";
import { colourSwatches } from "../../utils/colourPicks";
import { CHANNELS_COPY } from "../AssistantHome/copy/channels";
import { BrandPreview } from "../Onboarding/BrandPreview";
import { COPY } from "../Onboarding/copy";

/** ally-be's limit on the welcome line (`BOT_PAGE_BOUNDS.maxWelcomeChars`). */
export const MAX_WELCOME_CHARS = 140;

/**
 * The welcome line (stage 7): one short line under the name. Saved when it loses focus or on Enter,
 * through the look's PATCH, so it is the same change the logo and colour make.
 */
const WelcomeField: React.FC<{ botId: string; value: string; canEdit: boolean }> = ({
  botId,
  value,
  canEdit,
}) => {
  const id = useId();
  const [text, setText] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [save, { isLoading }] = useUpdateBotPageBrandMutation();
  useEffect(() => setText(value), [value]);
  const commit = () => {
    const next = text.trim();
    if (!canEdit || next === value.trim()) return;
    setError(null);
    save({ id: botId, welcome: next })
      .unwrap()
      .catch(() => setError(COPY.look.errors.failed));
  };
  return (
    <section className="ally-field">
      <label className="ally-heading" htmlFor={`${id}-welcome`}>
        {CHANNELS_COPY.look.welcome}
      </label>
      <input
        id={`${id}-welcome`}
        className="ally-input"
        value={text}
        maxLength={MAX_WELCOME_CHARS}
        disabled={!canEdit || isLoading}
        aria-describedby={`${id}-welcome-hint`}
        onChange={event => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={event => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          }
        }}
      />
      <span id={`${id}-welcome-hint`} className="ally-field__hint">
        {CHANNELS_COPY.look.welcomeHint}
      </span>
      {error && (
        <p className="ally-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
};

/**
 * Look and feel. Since stage 7 the page shows its name (the Name field above), the logo, one
 * accent colour and a short welcome line, with a live preview. Heading style, theme, cover, share
 * and team images are retired: ally-be keeps what was stored but no longer accepts or shows it.
 * Every change saves as you go, with "Changed · Undo". Presentation only: the state and saving are
 * `useBrandEditor`.
 */
export const LookAndFeel: React.FC<{
  name: string;
  editor: BrandEditor;
  canEdit: boolean;
  live: boolean;
  /** The bot, for the welcome line's save. Without it the welcome line is not drawn. */
  botId?: string;
  welcome?: string;
  /** Retired in stage 7; ignored. */
  teamNames?: string[];
}> = ({ name, editor, canEdit, live, botId, welcome = "" }) => {
  const brand = editor.brand;
  if (!brand) return null;

  const logo = editor.imageFor("logo");
  const swatches = colourSwatches(brand.accent);
  const slotLabels = {
    empty: COPY.make.upload,
    replace: COPY.make.change,
    remove: COPY.make.remove,
  };

  return (
    <div className="ally-v2 ally-look" data-testid="look-and-feel">
      <div className="ally-look__controls">
        <div className="ally-look__head">
          <h2 className="ally-heading" style={{ fontSize: 22 }}>
            {COPY.look.title}
          </h2>
          <span className="ally-small" aria-live="polite">
            {editor.saved && editor.changed && live ? COPY.look.savedLive : COPY.look.savesAsYouGo}
          </span>
        </div>
        <p className="ally-small" style={{ margin: 0 }}>
          {CHANNELS_COPY.look.lookNote}
        </p>

        <section className="ally-field">
          <h3 className="ally-heading">{COPY.look.sections.logo}</h3>
          <div className="ally-look__logo">
            <div style={{ width: 96, flex: "none" }}>
              <ImageSlot
                name={COPY.look.sections.logo}
                labels={slotLabels}
                src={logo?.urls[256]}
                alt={logo?.alt}
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                height={96}
                disabled={!canEdit || editor.uploading.logo}
                progress={editor.uploading.logo ? 60 : null}
                error={editor.errors.logo}
                onFile={file => void editor.upload("logo", file)}
                onRemove={() => editor.remove("logo")}
              />
            </div>
            <div>
              <p className="ally-body" style={{ margin: 0 }}>
                {logo?.fileName || COPY.make.logoInitials}
              </p>
              <p className="ally-small" style={{ margin: "4px 0 0" }}>
                {COPY.look.logoHint}
              </p>
            </div>
          </div>
        </section>

        <section className="ally-field">
          <ColourPicker
            label={COPY.make.colour}
            value={brand.accent ?? swatches[0]}
            swatches={swatches}
            customLabel={COPY.make.colour}
            onChange={hex => {
              if (canEdit) editor.change({ accent: hex.toUpperCase() });
            }}
          />
        </section>

        {botId && <WelcomeField botId={botId} value={welcome} canEdit={canEdit} />}
      </div>

      <div className="ally-look__preview">
        <span className="ally-label">{COPY.look.previewSwitch.bot}</span>
        <PhonePreview label={COPY.look.previewSwitch.bot}>
          <BrandPreview
            name={name}
            brand={brand}
            logoSrc={logo?.urls[256] ?? null}
            coverSrc={null}
            screen="cover"
            introduction={welcome}
          />
        </PhonePreview>
      </div>

      {editor.changed && (
        <Toast
          message={COPY.look.changed}
          actionLabel={COPY.look.undo}
          onAction={editor.undo}
          onDone={editor.dismissChanged}
        />
      )}
    </div>
  );
};

/** Channels → Look and feel: the bot's page and its brand editor, for `LookAndFeel`. */
export const LookAndFeelSection: React.FC<{ bot: Chatbot; canEdit: boolean }> = ({
  bot,
  canEdit,
}) => {
  const editor = useBrandEditor(bot.id, COPY.look.errors.failed);
  const { data: page } = useGetBotPageQuery(bot.id);
  return (
    <LookAndFeel
      name={page?.settings.branding.title || bot.name}
      editor={editor}
      canEdit={canEdit}
      live={Boolean(page?.live.ok)}
      botId={bot.id}
      welcome={page?.settings.branding.welcome ?? ""}
    />
  );
};
