import React, { useRef } from "react";

import { useGetBotPageQuery, useGetChatbotTeamNamesQuery } from "@api";
import { ColourPicker, ImageSlot, PhonePreview, Segmented, Toast } from "@components/v2";
import type { Chatbot } from "@types";

import { BrandEditor, useBrandEditor } from "../../hooks/brand/useBrandEditor";
import { colourSwatches } from "../../utils/colourPicks";
import { BrandPreview } from "../Onboarding/BrandPreview";
import { COPY } from "../Onboarding/copy";

import type { BotPageBrand, HeadingStyle } from "../../types/botPage";

const HEADINGS: { id: HeadingStyle; label: string; font: string; weight: number }[] = [
  {
    id: "classic",
    label: COPY.look.headingStyles.classic,
    font: "var(--ally-font-display)",
    weight: 400,
  },
  { id: "modern", label: COPY.look.headingStyles.modern, font: "var(--ally-font-ui)", weight: 600 },
  {
    id: "friendly",
    label: COPY.look.headingStyles.friendly,
    font: "var(--ally-font-friendly)",
    weight: 700,
  },
];

/** A team member's row: their photo (or initials), name, and Add photo / Replace. */
const TeamRow: React.FC<{
  name: string;
  photo: string | null;
  busy: boolean;
  disabled: boolean;
  error: string | null;
  onFile: (file: File) => void;
}> = ({ name, photo, busy, disabled, error, onFile }) => {
  const input = useRef<HTMLInputElement>(null);
  return (
    <li className="ally-look__person">
      {photo ? (
        <img src={photo} alt="" width={44} height={44} />
      ) : (
        <span className="ally-look__avatar" aria-hidden="true">
          {name
            .split(/\s+/)
            .filter(w => !/^(dr|mr|ms|mrs)\.?$/i.test(w))
            .slice(0, 2)
            .map(w => w[0])
            .join("")}
        </span>
      )}
      <span style={{ flex: 1 }}>{name}</span>
      <button
        type="button"
        className="ally-link"
        disabled={disabled || busy}
        aria-label={`${photo ? COPY.look.teamActions.replace : COPY.look.teamActions.add}: ${name}`}
        onClick={() => input.current?.click()}
      >
        {photo ? COPY.look.teamActions.replace : COPY.look.teamActions.add}
      </button>
      <input
        ref={input}
        type="file"
        hidden
        accept="image/png,image/jpeg,image/webp"
        onChange={event => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) onFile(file);
        }}
      />
      {error && (
        <p className="ally-error" role="alert" style={{ flexBasis: "100%" }}>
          {error}
        </p>
      )}
    </li>
  );
};

/**
 * Look and feel (chunk 20d §5, screenshot 06-look-and-feel): the page's logo, images, team photos
 * and style on the left, a live preview on the right. Every change saves as you go, with
 * "Changed · Undo". Presentation only: the state and saving are `useBrandEditor`.
 */
export const LookAndFeel: React.FC<{
  name: string;
  editor: BrandEditor;
  canEdit: boolean;
  teamNames: string[];
  live: boolean;
  subtitle?: string;
  disclaimer?: string;
}> = ({ name, editor, canEdit, teamNames, live, subtitle, disclaimer }) => {
  const brand = editor.brand;
  if (!brand) return null;

  const logo = editor.imageFor("logo");
  const cover = editor.imageFor("coverImage");
  const share = editor.imageFor("shareImage");
  const swatches = colourSwatches(brand.accent);
  const set = (patch: Partial<BotPageBrand>) => {
    if (canEdit) editor.change(patch);
  };
  const slotLabels = {
    empty: COPY.look.slotEmpty,
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

        <section className="ally-field">
          <h3 className="ally-heading">{COPY.look.sections.logo}</h3>
          <div className="ally-look__logo">
            <div style={{ width: 96, flex: "none" }}>
              <ImageSlot
                name={COPY.look.sections.logo}
                labels={{ ...slotLabels, empty: COPY.make.upload }}
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
          <h3 className="ally-heading">{COPY.look.sections.images}</h3>
          <p className="ally-small" style={{ margin: 0 }}>
            {COPY.look.imagesHint}
          </p>
          <div className="ally-look__slots">
            {(
              [
                ["coverImage", COPY.look.slots.cover, cover],
                ["shareImage", COPY.look.slots.share, share],
              ] as const
            ).map(([slot, label, image]) => (
              <div key={slot} className="ally-field">
                <span className="ally-field__label">{label}</span>
                <ImageSlot
                  name={label}
                  labels={slotLabels}
                  src={image?.urls[768]}
                  alt={image?.alt}
                  fileName={image?.fileName}
                  disabled={!canEdit || editor.uploading[slot]}
                  progress={editor.uploading[slot] ? 60 : null}
                  error={editor.errors[slot]}
                  onFile={file => void editor.upload(slot, file)}
                  onRemove={() => editor.remove(slot)}
                />
              </div>
            ))}
          </div>
        </section>

        {teamNames.length > 0 && (
          <section className="ally-field">
            <h3 className="ally-heading">{COPY.look.sections.team}</h3>
            <ul className="ally-look__team">
              {teamNames.map(person => {
                const id = brand.peoplePhotos[person];
                return (
                  <TeamRow
                    key={person}
                    name={person}
                    photo={id ? (editor.images[id]?.urls[256] ?? null) : null}
                    busy={editor.personUploading === person}
                    disabled={!canEdit}
                    error={editor.personError?.name === person ? editor.personError.message : null}
                    onFile={file => void editor.uploadPerson(person, file)}
                  />
                );
              })}
            </ul>
            <p className="ally-small" style={{ margin: 0 }}>
              {COPY.look.teamHint}
            </p>
          </section>
        )}

        <section className="ally-field">
          <h3 className="ally-heading">{COPY.look.sections.style}</h3>
          <div
            className="ally-look__headings"
            role="radiogroup"
            aria-label={COPY.look.sections.style}
          >
            {HEADINGS.map(h => (
              <button
                key={h.id}
                type="button"
                role="radio"
                aria-checked={brand.headingStyle === h.id}
                className="ally-option ally-press"
                disabled={!canEdit}
                onClick={() => set({ headingStyle: h.id })}
              >
                <span style={{ fontFamily: h.font, fontSize: 30, fontWeight: h.weight }}>Aa</span>
                <span className="ally-small">{h.label}</span>
              </button>
            ))}
          </div>
          <ColourPicker
            label={COPY.make.colour}
            value={brand.accent ?? swatches[0]}
            swatches={swatches}
            customLabel={COPY.make.colour}
            onChange={hex => set({ accent: hex.toUpperCase() })}
          />
          <Segmented
            label={COPY.look.themeLabel}
            value={brand.theme}
            options={[
              { id: "light", label: COPY.look.themes.light },
              { id: "dark", label: COPY.look.themes.dark },
              { id: "auto", label: COPY.look.themes.auto },
            ]}
            onChange={theme => set({ theme })}
          />
        </section>
      </div>

      <div className="ally-look__preview">
        {/* The Landing page preview arrives with chunk 20e. */}
        <span className="ally-label">{COPY.look.previewSwitch.bot}</span>
        <PhonePreview label={COPY.look.previewSwitch.bot}>
          <BrandPreview
            name={name}
            brand={brand}
            logoSrc={logo?.urls[256] ?? null}
            coverSrc={cover?.urls[768] ?? null}
            screen="cover"
            introduction={subtitle}
            disclaimer={disclaimer}
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

/** Settings → Look and feel: the bot's page, its brand editor and its team, for `LookAndFeel`. */
export const LookAndFeelSection: React.FC<{ bot: Chatbot; canEdit: boolean }> = ({
  bot,
  canEdit,
}) => {
  const editor = useBrandEditor(bot.id, COPY.look.errors.failed);
  const { data: page } = useGetBotPageQuery(bot.id);
  const { data: team } = useGetChatbotTeamNamesQuery(bot.id);
  return (
    <LookAndFeel
      name={page?.settings.branding.title || bot.name}
      editor={editor}
      canEdit={canEdit}
      teamNames={team?.names ?? []}
      live={Boolean(page?.live.ok)}
      subtitle={page?.settings.branding.subtitle}
      disclaimer={page?.settings.branding.disclaimer}
    />
  );
};
