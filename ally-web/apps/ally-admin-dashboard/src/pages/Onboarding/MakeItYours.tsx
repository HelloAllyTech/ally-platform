import React, { useState } from "react";

import {
  ColourPicker,
  ImageSlot,
  PhonePreview,
  PrimaryButton,
  Question,
  Segmented,
  Toast,
  useEnterToSubmit,
} from "@components/v2";

import { BrandPreview } from "./BrandPreview";
import { COPY } from "./copy";
import { colourSwatches } from "../../utils/colourPicks";
import { AvoidTopics } from "../AssistantHome/AvoidTopics";

import type { BotDraftView, PatchOp } from "./types";
import type { BrandEditor } from "../../hooks/brand/useBrandEditor";

/** The last part of a URL's path: "https://site/img/logo.png" → "logo.png". */
const fileOf = (url: string | null | undefined) => {
  try {
    return url ? (new URL(url).pathname.split("/").pop() ?? "") : "";
  } catch {
    return "";
  }
};

/**
 * Logo, cover and colour on "Make it yours" (copy §16): the brand editor's state drawn as the
 * screenshot's controls. Uploads and saves are the editor's.
 */
export const BrandControls: React.FC<{ view: BotDraftView; editor: BrandEditor }> = ({
  view,
  editor,
}) => {
  const brand = editor.brand;
  if (!brand) return null;
  const logo = editor.imageFor("logo");
  const cover = editor.imageFor("coverImage");
  const siteLogo = fileOf(view.crawl.brand?.logoUrl);
  const logoNote = !logo
    ? COPY.make.logoInitials
    : siteLogo && logo.fileName === siteLogo
      ? COPY.make.logoFromSite
      : logo.fileName || COPY.make.logoFromSite;
  const swatches = colourSwatches(view.crawl.brand?.accentColour ?? brand.accent);
  return (
    <>
      <div className="ally-field">
        <span className="ally-field__label">{COPY.make.images}</span>
        <div className="ally-make__images">
          <div className="ally-make__logo">
            <ImageSlot
              name={COPY.make.images}
              labels={{
                empty: COPY.make.upload,
                replace: COPY.make.upload,
                remove: COPY.make.remove,
              }}
              src={logo?.urls[256]}
              alt={logo?.alt}
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              height={120}
              disabled={editor.uploading.logo}
              progress={editor.uploading.logo ? 60 : null}
              error={editor.errors.logo}
              onFile={file => void editor.upload("logo", file)}
              onRemove={() => editor.remove("logo")}
            />
            <span className="ally-small">{logoNote}</span>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <ImageSlot
              name={COPY.make.coverEmpty}
              labels={{
                empty: COPY.make.coverEmpty,
                replace: COPY.make.change,
                remove: COPY.make.remove,
              }}
              src={cover?.urls[768]}
              alt={cover?.alt}
              fileName={cover?.fileName}
              height={120}
              disabled={editor.uploading.coverImage}
              progress={editor.uploading.coverImage ? 60 : null}
              error={editor.errors.coverImage}
              onFile={file => void editor.upload("coverImage", file)}
              onRemove={() => editor.remove("coverImage")}
            />
          </div>
        </div>
        <span className="ally-field__hint">{COPY.make.imageHint}</span>
      </div>
      <div className="ally-field">
        <span className="ally-field__label">
          {COPY.make.colour} <span className="ally-field__hint">· {COPY.make.colourHint}</span>
        </span>
        <ColourPicker
          label={COPY.make.colour}
          value={brand.accent ?? swatches[0]}
          swatches={swatches}
          customLabel={COPY.make.colour}
          onChange={hex => editor.change({ accent: hex.toUpperCase() })}
        />
      </div>
      {editor.changed && (
        <Toast
          message={COPY.look.changed}
          actionLabel={COPY.look.undo}
          onAction={editor.undo}
          onDone={editor.dismissChanged}
        />
      )}
    </>
  );
};

/** The phone on "Make it yours": the chat as visitors will open it, with the current settings. */
export const MakePreview: React.FC<{
  view: BotDraftView;
  editor: BrandEditor;
  name: string;
  opening: string;
}> = ({ view, editor, name, opening }) =>
  editor.brand ? (
    <PhonePreview label={COPY.make.title}>
      <BrandPreview
        name={name}
        brand={editor.brand}
        logoSrc={editor.imageFor("logo")?.urls[256] ?? null}
        coverSrc={editor.imageFor("coverImage")?.urls[768] ?? null}
        screen="chat"
        introduction={opening}
        suggestedQuestions={view.draft.suggestedQuestions.slice(0, 3)}
        statusLine={COPY.make.previewStatus}
      />
    </PhonePreview>
  ) : null;

/** The deck's three tones (copy §16) and the draft's tone values they set. */
export const TONES = [
  { id: "warm", label: COPY.make.tones.warm, value: "warm" },
  { id: "balanced", label: COPY.make.tones.balanced, value: "professional" },
  { id: "formal", label: COPY.make.tones.formal, value: "formal" },
] as const;
export type ToneId = (typeof TONES)[number]["id"];

export const toneOf = (value: string): ToneId =>
  TONES.find(t => t.value === value)?.id ?? (value === "friendly" ? "warm" : "balanced");

/**
 * "Make it yours" (chunk 20d §2): the built assistant's name, tone and opening line, each saved as
 * a draft patch as the owner leaves the field. Presentation over `useOnboardingSession.edit`.
 */
export const MakeItYoursScreen: React.FC<{
  view: BotDraftView;
  onPatch: (target: "draft", ops: PatchOp[]) => Promise<boolean>;
  onContinue: () => void;
  /** The page's look (logo, cover, colour) and the live phone preview. */
  editor?: BrandEditor;
}> = ({ view, onPatch, onContinue, editor }) => {
  const draft = view.draft;
  const [name, setName] = useState(draft.assistantName);
  const [opening, setOpening] = useState(draft.introduction);
  const [tone, setTone] = useState<ToneId>(toneOf(draft.tone));
  useEnterToSubmit(onContinue);

  const save = (path: string, value: string, current: string) => {
    const next = value.trim();
    if (next && next !== current) void onPatch("draft", [{ op: "replace", path, value: next }]);
  };

  return (
    <div className="ally-make">
      <div className="ally-make__controls">
        <Question title={COPY.make.title} subtitle={COPY.make.subtitle} />
        <div className="ally-field">
          <label htmlFor="make-name">{COPY.make.name}</label>
          <input
            id="make-name"
            className="ally-input"
            value={name}
            maxLength={60}
            onChange={event => setName(event.target.value)}
            onBlur={() => save("/assistantName", name, draft.assistantName)}
          />
        </div>
        {editor && <BrandControls view={view} editor={editor} />}
        <div className="ally-field">
          <span className="ally-field__label" id="make-tone">
            {COPY.make.tone}
          </span>
          <Segmented
            label={COPY.make.tone}
            value={tone}
            options={TONES.map(t => ({ id: t.id, label: t.label }))}
            onChange={id => {
              setTone(id);
              const value = TONES.find(t => t.id === id)!.value;
              if (value !== draft.tone)
                void onPatch("draft", [{ op: "replace", path: "/tone", value }]);
            }}
          />
        </div>
        <div className="ally-field">
          <label htmlFor="make-opening">{COPY.make.opening}</label>
          <textarea
            id="make-opening"
            className="ally-input"
            value={opening}
            maxLength={600}
            onChange={event => setOpening(event.target.value)}
            onBlur={() => save("/introduction", opening, draft.introduction)}
          />
        </div>
        <AvoidTopics botId={view.chatbotId ?? null} />
        <PrimaryButton enterHint={COPY.frame.enterHint} onClick={onContinue}>
          {COPY.make.checkup}
        </PrimaryButton>
      </div>
      {editor && (
        <div className="ally-make__preview">
          <MakePreview view={view} editor={editor} name={name} opening={opening} />
        </div>
      )}
    </div>
  );
};
