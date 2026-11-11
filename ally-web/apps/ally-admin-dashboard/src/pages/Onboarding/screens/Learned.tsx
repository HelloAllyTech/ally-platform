import React, { useEffect, useRef, useState } from "react";

import {
  Button,
  LearnedCard as LearnedRow,
  OptionList,
  Orb,
  PrimaryButton,
  Question,
  keysHintFor,
  useEnterToSubmit,
} from "@components/v2";

import { COPY, fill } from "../copy";
import { ACCEPTED_FILES } from "../useDraftUpload";

import type { BotDraftView, LearnedFact, LearnedSection, PatchOp } from "../types";

// ── 3. What we learned ────────────────────────────────────────────────────

const SECTIONS = Object.keys(COPY.learned.sections) as LearnedSection[];
const N = COPY.learned.nothing;

const sourceLabel = (fact: LearnedFact) => {
  if (fact.byOwner || fact.sourceUrl === "owner") return COPY.learned.fromYou;
  return fact.sourceTitle || fact.sourceUrl;
};
const sourceHref = (fact: LearnedFact) =>
  /^https?:\/\//.test(fact.sourceUrl) ? fact.sourceUrl : null;

/** The ways on when nothing was found. Each resolves false if it was refused (and said why). */
export interface NothingFoundActions {
  onDescribe: (text: string) => Promise<boolean>;
  onUpload: (files: File[]) => Promise<boolean>;
  onStartOver: () => void;
}

export const LearnedScreen: React.FC<
  {
    view: BotDraftView;
    busy: boolean;
    onPatch: (target: "learned", ops: PatchOp[]) => Promise<boolean>;
    onConfirm: () => void;
  } & Partial<NothingFoundActions>
> = ({ view, busy, onPatch, onConfirm, onDescribe, onUpload, onStartOver }) => {
  const facts = view.learned.facts;
  const canConfirm = view.step === "learned";
  const nothing = canConfirm && facts.length === 0 && onDescribe && onUpload && onStartOver;
  useEnterToSubmit(onConfirm, canConfirm && !busy && !nothing);
  if (nothing) {
    return (
      <NothingFound
        view={view}
        busy={busy}
        onSkip={onConfirm}
        onDescribe={onDescribe}
        onUpload={onUpload}
        onStartOver={onStartOver}
      />
    );
  }
  return (
    <>
      <Question title={COPY.learned.title} subtitle={COPY.learned.subtitle} />
      {SECTIONS.map(section => {
        const inSection = facts
          .map((fact, index) => ({ fact, index }))
          .filter(({ fact }) => fact.section === section);
        return (
          <section key={section} className="ally-learned-group">
            <h2 className="ally-label" style={{ margin: 0 }}>
              {COPY.learned.sections[section]}
            </h2>
            {inSection.length === 0 ? (
              <p className="ally-empty">{COPY.learned.empty}</p>
            ) : (
              <ul
                className="ally-learned-group"
                style={{ listStyle: "none", margin: 0, padding: 0 }}
              >
                {inSection.map(({ fact, index }, i) => (
                  <LearnedRow
                    key={fact.id}
                    index={i}
                    text={fact.text}
                    source={{ label: sourceLabel(fact), href: sourceHref(fact) }}
                    labels={COPY.learned}
                    busy={busy}
                    onSave={text =>
                      onPatch("learned", [
                        { op: "replace", path: `/facts/${index}/text`, value: text },
                      ])
                    }
                    onRemove={() =>
                      void onPatch("learned", [{ op: "remove", path: `/facts/${index}` }])
                    }
                  />
                ))}
              </ul>
            )}
          </section>
        );
      })}
      {canConfirm && (
        <PrimaryButton enterHint={COPY.frame.enterHint} onClick={onConfirm} disabled={busy}>
          {COPY.learned.confirm}
        </PrimaryButton>
      )}
    </>
  );
};

/** How long "Reading what you sent…" waits for a reply before offering the choices again. */
const READ_WAIT_MS = 120_000;

/**
 * Nothing found (chunk 20a-2): instead of eight "Not found" rows and only "Looks right", say why
 * (the crawl's own problem) and offer the ways on. A description or documents are read here, and
 * the details replace this screen as they arrive; another website starts again; skipping goes on
 * to the questions, which ask for what's missing.
 */
const NothingFound: React.FC<
  { view: BotDraftView; busy: boolean; onSkip: () => void } & NothingFoundActions
> = ({ view, busy, onSkip, onDescribe, onUpload, onStartOver }) => {
  const [mode, setMode] = useState<"choose" | "describe" | "reading">("choose");
  const [description, setDescription] = useState("");
  const [stillNothing, setStillNothing] = useState(false);
  const [round, setRound] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  // The builder answers in the chat once it has read what was sent; if the details are still
  // empty then, what was sent had none.
  const sentAt = useRef(0);
  const replies = view.transcript.length;

  useEffect(() => {
    if (mode !== "reading") return undefined;
    if (replies > sentAt.current) {
      setStillNothing(true);
      setMode("choose");
      return undefined;
    }
    const timer = setTimeout(() => {
      setStillNothing(true);
      setMode("choose");
    }, READ_WAIT_MS);
    return () => clearTimeout(timer);
  }, [mode, replies]);

  const sent = (ok: boolean) => {
    if (ok) {
      sentAt.current = replies;
      setStillNothing(false);
      setMode("reading");
    } else {
      backToChoices();
    }
  };
  const backToChoices = () => {
    setMode("choose");
    setRound(r => r + 1);
  };

  const domain = view.source.website ? view.crawl.domain : null;
  const why = N.why[view.crawl.problem as keyof typeof N.why] ?? N.why.little_found;
  const title = domain ? fill(N.title, { domain }) : N.titleNoSite;

  if (mode === "reading") {
    return (
      <>
        <Question title={title} />
        <div style={{ display: "flex", alignItems: "center", gap: 16 }} aria-live="polite">
          <Orb size={44} working />
          <span className="ally-body">{N.reading}</span>
        </div>
      </>
    );
  }

  if (mode === "describe") {
    return (
      <Question title={N.describe} subtitle={COPY.start.describePrompt}>
        <form
          style={{ display: "flex", flexDirection: "column", gap: 14 }}
          onSubmit={async event => {
            event.preventDefault();
            if (description.trim().length >= 20) sent(await onDescribe(description));
          }}
        >
          <textarea
            aria-label={N.describe}
            className="ally-input"
            rows={5}
            value={description}
            onChange={event => setDescription(event.target.value)}
            placeholder={COPY.start.describePlaceholder}
            autoFocus
          />
          <div className="ally-btn-row">
            <PrimaryButton type="submit" disabled={description.trim().length < 20 || busy}>
              {N.read}
            </PrimaryButton>
            <Button variant="ghost" onClick={backToChoices}>
              {N.backToChoices}
            </Button>
          </div>
        </form>
      </Question>
    );
  }

  const options = [
    { id: "describe", label: N.describe, hint: N.describeHint },
    { id: "upload", label: N.upload, hint: N.uploadHint },
    ...(view.source.website
      ? [{ id: "otherSite", label: N.otherSite, hint: N.otherSiteHint }]
      : []),
    { id: "skip", label: N.skip, hint: N.skipHint },
  ];
  return (
    <>
      <Question title={title} subtitle={stillNothing ? N.stillNothing : why} />
      <p className="ally-label" style={{ margin: 0 }}>
        {N.choose}
      </p>
      <OptionList
        key={round}
        label={N.choose}
        keysHint={keysHintFor(COPY.frame.optionsHint, options.length)}
        options={options}
        disabled={busy}
        onChoose={option => {
          if (option.id === "describe") setMode("describe");
          else if (option.id === "upload") {
            fileRef.current?.click();
            // The file picker can be cancelled; the list must be usable again either way.
            setRound(r => r + 1);
          } else if (option.id === "otherSite") onStartOver();
          else onSkip();
        }}
      />
      <input
        ref={fileRef}
        type="file"
        multiple
        accept={ACCEPTED_FILES}
        hidden
        data-testid="learned-upload"
        onChange={async event => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          if (files.length) sent(await onUpload(files));
        }}
      />
      <p className="ally-small" style={{ margin: 0 }}>
        {COPY.start.uploadLimits}
      </p>
    </>
  );
};
