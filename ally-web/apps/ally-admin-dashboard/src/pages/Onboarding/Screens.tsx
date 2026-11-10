import React, { useEffect, useRef, useState } from "react";

import QRCode from "qrcode";
import { toast } from "sonner";

import {
  AssistantLine,
  BuildSteps,
  Button,
  Chip,
  DesignCard as DesignCardView,
  FindingLine,
  LearnedCard as LearnedRow,
  OptionList,
  Orb,
  PrimaryButton,
  ProgressBar,
  Question,
  SafetyCard as SafetyCardView,
  keysHintFor,
  useEnterToSubmit,
} from "@components/v2";

import { ChoosePages } from "./ChoosePages";
import { COPY, fill } from "./copy";
import { parseEmails } from "./flow";

import type {
  BotDraftView,
  DesignCard,
  LearnedFact,
  LearnedSection,
  PatchOp,
  PublishResult,
} from "./types";
import type { ReadingProgress } from "./useBotDraftSession";

/**
 * Onboarding's screens, one per step (chunk 20d, DESIGN.md §5). Presentation only: each draws
 * what `useOnboardingSession` decided and calls its actions. `OnboardingSession.tsx` puts the
 * current one inside the StepFrame.
 */

/** "…turned on **Mental health safety**." → the pack name in bold, as the chat showed it. */
export const withBold = (text: string): React.ReactNode =>
  text.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 ? <strong key={i}>{part}</strong> : part));

const MAX_PAGES = 50;

// ── 2. Reading your website ───────────────────────────────────────────────

export const ReadingScreen: React.FC<{
  view: BotDraftView;
  reading: ReadingProgress;
  onDone: () => void;
}> = ({ view, reading, onDone }) => {
  const [slow, setSlow] = useState(false);
  // "Read everything · Choose pages" (chunk 20a-2): a website's draft can choose while it reads.
  const [choosing, setChoosing] = useState(false);
  const running = view.crawl.status === "running" && !reading.done;
  useEffect(() => {
    if (!running) return undefined;
    const timer = setTimeout(() => setSlow(true), 45_000);
    return () => clearTimeout(timer);
  }, [running]);
  const read = Math.max(reading.read, view.crawl.pagesRead);
  const done =
    reading.done ??
    (view.crawl.finishedAt && view.crawl.startedAt
      ? {
          n: view.crawl.pagesRead,
          seconds: Math.max(
            1,
            Math.round(
              (Date.parse(view.crawl.finishedAt) - Date.parse(view.crawl.startedAt)) / 1000,
            ),
          ),
        }
      : null);
  const domain = reading.domain ?? view.crawl.domain ?? "";
  useEnterToSubmit(onDone, Boolean(done));
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <Orb size={44} working={!done} />
        <span className="ally-label">{COPY.reading.title}</span>
      </div>
      <h1 className="ally-display">
        {done ? fill(COPY.reading.done, done) : fill(COPY.reading.status, { domain })}
      </h1>
      <div aria-live="polite" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between" }} className="ally-small">
          <span>{fill(COPY.reading.progress, { n: read })}</span>
          <span className="ally-label" aria-hidden="true">
            {read}/{MAX_PAGES}
          </span>
        </div>
        <ProgressBar
          value={done ? MAX_PAGES : Math.min(read, MAX_PAGES)}
          max={MAX_PAGES}
          label={COPY.reading.title}
        />
        {slow && !done && <p className="ally-small">{COPY.reading.takingLong}</p>}
      </div>
      {view.source.website &&
        (choosing ? (
          <ChoosePages draftId={view.id} onClose={() => setChoosing(false)} />
        ) : (
          <div className="ally-btn-row" role="group" aria-label={COPY.pages.title}>
            <Chip selected onToggle={() => setChoosing(false)}>
              {COPY.pages.readEverything}
            </Chip>
            <Chip onToggle={() => setChoosing(true)}>{COPY.pages.choosePages}</Chip>
          </div>
        ))}
      {reading.findings.length > 0 && (
        <ul className="ally-findings" aria-live="polite">
          {reading.findings.map((line, i) => (
            <FindingLine key={line} index={i}>
              {line}
            </FindingLine>
          ))}
        </ul>
      )}
      {done && (
        <PrimaryButton enterHint={COPY.frame.enterHint} onClick={onDone}>
          {COPY.frame.readingDone}
        </PrimaryButton>
      )}
    </>
  );
};

// ── 3. What we learned ────────────────────────────────────────────────────

const SECTIONS = Object.keys(COPY.learned.sections) as LearnedSection[];

const sourceLabel = (fact: LearnedFact) => {
  if (fact.byOwner || fact.sourceUrl === "owner") return COPY.learned.fromYou;
  return fact.sourceTitle || fact.sourceUrl;
};
const sourceHref = (fact: LearnedFact) =>
  /^https?:\/\//.test(fact.sourceUrl) ? fact.sourceUrl : null;

export const LearnedScreen: React.FC<{
  view: BotDraftView;
  busy: boolean;
  onPatch: (target: "learned", ops: PatchOp[]) => Promise<boolean>;
  onConfirm: () => void;
}> = ({ view, busy, onPatch, onConfirm }) => {
  const facts = view.learned.facts;
  const canConfirm = view.step === "learned";
  useEnterToSubmit(onConfirm, canConfirm && !busy);
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

// ── 4. Safety ─────────────────────────────────────────────────────────────

export const SafetyScreen: React.FC<{
  view: BotDraftView;
  line?: string;
  onContinue?: () => void;
}> = ({ view, line, onContinue }) => {
  const pack = view.safety;
  useEnterToSubmit(() => onContinue?.(), Boolean(onContinue && pack));
  if (!pack) return null;
  return (
    <>
      {line && <AssistantLine>{withBold(line)}</AssistantLine>}
      <SafetyCardView
        title={fill(COPY.safety.title, { "Pack name": pack.name })}
        body={fill(COPY.safety.body, { industry: pack.industryLabel })}
        panels={{
          always: COPY.safety.always,
          never: COPY.safety.never,
          atRisk: COPY.safety.atRisk,
        }}
        always={pack.always}
        never={pack.never}
        atRisk={pack.atRisk}
        toggleLabel={COPY.safety.link}
      />
      {onContinue && (
        <PrimaryButton enterHint={COPY.frame.enterHint} onClick={onContinue}>
          {COPY.frame.safetyContinue}
        </PrimaryButton>
      )}
    </>
  );
};

// ── 5…n. One question per screen ──────────────────────────────────────────

export const QuestionScreen: React.FC<{
  /** The builder's words before the question ("Done. I added those fees."). */
  lead?: string;
  title: string;
  subtitle: string;
  eyebrow: string | null;
  options: string[];
  multiSelect: boolean;
  textAnswer?: boolean;
  busy: boolean;
  working: string | null;
  streaming: string;
  onChoose: (chip: string) => void;
  onSay: (text: string) => void;
}> = ({
  lead,
  title,
  subtitle,
  eyebrow,
  options,
  multiSelect,
  textAnswer = !options.length,
  busy,
  working,
  streaming,
  onChoose,
  onSay,
}) => {
  const [chosen, setChosen] = useState<string[]>([]);
  const [text, setText] = useState("");
  const submitMulti = () => {
    if (chosen.length) onSay(chosen.join(", "));
  };
  const submitText = () => {
    if (text.trim()) onSay(text.trim());
  };
  useEnterToSubmit(multiSelect ? submitMulti : submitText, !busy && (multiSelect || textAnswer));

  if (busy) {
    return (
      <AssistantLine working streaming={Boolean(streaming)}>
        {streaming || working || ""}
      </AssistantLine>
    );
  }
  const answerBox = textAnswer && !multiSelect && (
    <form
      style={{ display: "flex", flexDirection: "column", gap: 14 }}
      onSubmit={event => {
        event.preventDefault();
        submitText();
      }}
    >
      <textarea
        className="ally-input"
        aria-label={title}
        placeholder={COPY.gaps.answerPlaceholder}
        value={text}
        autoFocus
        onChange={event => setText(event.target.value)}
        onKeyDown={event => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            submitText();
          }
        }}
      />
      <PrimaryButton type="submit" enterHint={COPY.frame.enterHint} disabled={!text.trim()}>
        {COPY.gaps.ok}
      </PrimaryButton>
    </form>
  );
  return (
    <>
      {lead && <AssistantLine>{withBold(lead)}</AssistantLine>}
      <Question eyebrow={eyebrow ?? undefined} title={title} subtitle={subtitle || undefined}>
        {answerBox}
        {multiSelect ? (
          <>
            <div className="ally-chips" role="group" aria-label={title}>
              {options.map(option => (
                <Chip
                  key={option}
                  selected={chosen.includes(option)}
                  onToggle={() =>
                    setChosen(c =>
                      c.includes(option) ? c.filter(x => x !== option) : [...c, option],
                    )
                  }
                >
                  {option}
                </Chip>
              ))}
            </div>
            <PrimaryButton
              enterHint={COPY.frame.enterHint}
              disabled={!chosen.length}
              onClick={submitMulti}
            >
              {COPY.gaps.ok}
            </PrimaryButton>
          </>
        ) : options.length ? (
          <OptionList
            label={title}
            keysHint={keysHintFor(COPY.frame.optionsHint, options.length)}
            options={options.map(option => ({ id: option, label: option }))}
            onChoose={option => onChoose(option.id)}
          />
        ) : null}
      </Question>
    </>
  );
};

// ── Choose a design ───────────────────────────────────────────────────────

/**
 * What should your assistant do? (chunk 20a-2): the five purpose cards, the recommended one first
 * and badged; "Something else" asks for a sentence. A draft offered the older designs still shows
 * them, with Coming soon.
 */
export const DesignScreen: React.FC<{
  designs: DesignCard[];
  chosen: string | null;
  canChoose: boolean;
  line?: string;
  onChoose: (id: string) => void;
  /** "Something else": the owner's sentence about what it's for. */
  onDescribe?: (text: string) => void;
}> = ({ designs, chosen, canChoose, line, onChoose, onDescribe }) => (
  <>
    {line && <AssistantLine>{line}</AssistantLine>}
    <h1 className="ally-heading">{COPY.purposes.title}</h1>
    {chosen === "custom" && canChoose && onDescribe && <DescribePurpose onDescribe={onDescribe} />}
    <div className="ally-designs">
      {designs.map((design, i) =>
        design.coming_soon ? (
          <DesignCardView
            key={design.id}
            index={i}
            title={COPY.designs.comingSoonTitle}
            body={COPY.designs.comingSoonBody}
            comingSoon
            labels={{ ...COPY.designs, comingSoon: COPY.designs.comingSoonBadge }}
          />
        ) : (
          <DesignCardView
            key={design.id}
            index={i}
            title={design.title}
            bestFor={design.best_for}
            will={design.will}
            wont={design.wont}
            sample={design.sample}
            chosen={chosen === design.id}
            canChoose={canChoose}
            recommended={design.recommended}
            limit={design.limit}
            labels={{
              ...COPY.designs,
              comingSoon: COPY.designs.comingSoonBadge,
              recommended: COPY.purposes.recommended,
            }}
            onChoose={() => onChoose(design.id)}
          />
        ),
      )}
    </div>
  </>
);

const DescribePurpose: React.FC<{ onDescribe: (text: string) => void }> = ({ onDescribe }) => {
  const [text, setText] = useState("");
  return (
    <form
      className="ally-field"
      data-testid="describe-purpose"
      onSubmit={event => {
        event.preventDefault();
        if (text.trim()) onDescribe(text.trim());
      }}
    >
      <label className="ally-field__label" htmlFor="purpose-note">
        {COPY.purposes.customPrompt}
      </label>
      <textarea
        id="purpose-note"
        className="ally-input"
        maxLength={600}
        value={text}
        onChange={event => setText(event.target.value)}
      />
      <div className="ally-btn-row">
        <PrimaryButton type="submit" disabled={!text.trim()}>
          {COPY.gaps.ok}
        </PrimaryButton>
      </div>
    </form>
  );
};

// ── Building ──────────────────────────────────────────────────────────────

/** While the builder writes, the steps tick at a steady pace, short of the last until it's done. */
export const useBuildTicks = (done: boolean): number => {
  const total = COPY.building.steps.length;
  const [ticked, setTicked] = useState(0);
  useEffect(() => {
    if (done) return undefined;
    const timer = setInterval(() => setTicked(n => Math.min(n + 1, total - 1)), 2500);
    return () => clearInterval(timer);
  }, [done, total]);
  return done ? total : ticked;
};

export const BuildingScreen: React.FC<{
  done: boolean;
  onContinue?: () => void;
  /** What the purpose set up (chunk 20a-2), once it's built. */
  confirmation?: string | null;
}> = ({ done, onContinue, confirmation }) => {
  const ticked = useBuildTicks(done);
  useEnterToSubmit(() => onContinue?.(), done && Boolean(onContinue));
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <Orb size={44} working={!done} />
        <h1 className="ally-display" style={{ fontSize: "clamp(30px, 4vw, 44px)" }}>
          {COPY.building.title}
        </h1>
      </div>
      <BuildSteps steps={[...COPY.building.steps]} done={ticked} />
      {done && confirmation && <AssistantLine>{confirmation}</AssistantLine>}
      {done && onContinue && (
        <PrimaryButton enterHint={COPY.frame.enterHint} onClick={onContinue}>
          {COPY.frame.buildingDone}
        </PrimaryButton>
      )}
    </>
  );
};

// ── Who can use it? ───────────────────────────────────────────────────────

type Access = "public" | "organisation" | "invite";

export const ShareScreen: React.FC<{
  view: BotDraftView;
  publicAllowed: boolean;
  publishing: boolean;
  /** An owner's Must pass question failed (chunk 20d-2): asked before going live. */
  mustPass?: { message: string; questions: string[]; onConfirm: () => void } | null;
  line?: string;
  onPublish: (access: Access, emails: string[]) => void;
}> = ({ view, publicAllowed, publishing, line, onPublish, mustPass }) => {
  const [access, setAccess] = useState<Access>(view.draft.access.mode ?? "invite");
  const [emails, setEmails] = useState(view.draft.access.emails.join(", "));
  const options: { id: Access; label: string; help: string; disabled?: boolean }[] = [
    {
      id: "public",
      label: COPY.share.public,
      help: publicAllowed ? COPY.share.publicHelp : COPY.share.publicDisabled,
      disabled: !publicAllowed,
    },
    { id: "organisation", label: COPY.share.organisation, help: COPY.share.organisationHelp },
    { id: "invite", label: COPY.share.invite, help: COPY.share.inviteHelp },
  ];
  const list = parseEmails(emails);
  const ready = (access !== "invite" || list.length > 0) && !publishing;
  const publish = () => ready && onPublish(access, access === "invite" ? list : []);
  useEnterToSubmit(publish, ready);
  return (
    <>
      {line && <AssistantLine>{line}</AssistantLine>}
      <Question title={COPY.share.title}>
        <fieldset style={{ border: 0, margin: 0, padding: 0 }} className="ally-options">
          <legend className="ally-sr-only">{COPY.share.title}</legend>
          {options.map(option => (
            <label
              key={option.id}
              className="ally-option"
              data-checked={access === option.id}
              style={option.disabled ? { opacity: 0.55, cursor: "not-allowed" } : undefined}
            >
              <input
                type="radio"
                name="access"
                checked={access === option.id}
                disabled={option.disabled}
                onChange={() => setAccess(option.id)}
              />
              <span className="ally-option__text">
                <span>{option.label}</span>
                <span className="ally-option__hint">{option.help}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {access === "invite" && (
          <div className="ally-field">
            <label htmlFor="invite-emails">{COPY.share.emailsLabel}</label>
            <textarea
              id="invite-emails"
              className="ally-input"
              value={emails}
              placeholder={COPY.share.emailsPlaceholder}
              onChange={event => setEmails(event.target.value)}
            />
            <span className="ally-field__hint">{COPY.share.emailsHelp}</span>
          </div>
        )}
        {mustPass && (
          <div className="ally-card ally-must-pass" role="alert" data-testid="must-pass">
            <p className="ally-body">{mustPass.message}</p>
            {mustPass.questions.length > 0 && (
              <ul className="ally-small">
                {mustPass.questions.map(q => (
                  <li key={q}>“{q}”</li>
                ))}
              </ul>
            )}
            <Button disabled={publishing} onClick={mustPass.onConfirm}>
              {COPY.share.goLiveAnyway}
            </Button>
          </div>
        )}
        <PrimaryButton enterHint={COPY.frame.enterHint} disabled={!ready} onClick={publish}>
          {publishing ? COPY.share.publishing : COPY.share.publish}
        </PrimaryButton>
      </Question>
    </>
  );
};

// ── Your assistant is live ────────────────────────────────────────────────

const copyLink = async (link: string) => {
  try {
    await navigator.clipboard.writeText(link);
    toast.success(COPY.share.copied);
  } catch {
    toast.error(COPY.problems.generic);
  }
};

export const Qr: React.FC<{ link: string }> = ({ link }) => {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    QRCode.toDataURL(link, { margin: 1, width: 512 })
      .then(url => current && setSrc(url))
      .catch(() => current && setSrc(null));
    return () => {
      current = false;
    };
  }, [link]);
  return src ? (
    <img src={src} alt="" width={160} height={160} data-testid="share-qr" />
  ) : (
    <div style={{ width: 160, height: 160 }} className="ally-card" />
  );
};

export const LiveScreen: React.FC<{
  view: BotDraftView;
  published: PublishResult;
  onConnectWhatsApp: () => void;
}> = ({ view, published, onConnectWhatsApp }) => {
  const qrRef = useRef<HTMLDivElement>(null);
  const share = fill(COPY.share.whatsAppText, { business: view.draft.name, link: published.link });
  useEnterToSubmit(() => void copyLink(published.link));
  const downloadQr = () => {
    const img = qrRef.current?.querySelector("img");
    if (!img) return;
    const a = document.createElement("a");
    a.href = img.src;
    a.download = `${published.slug}-qr.png`;
    a.click();
  };
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <span
          className="ally-tick ally-pop"
          aria-hidden="true"
          style={{ width: 40, height: 40, fontSize: 20 }}
        >
          ✓
        </span>
        <Question title={COPY.share.liveTitle} subtitle={COPY.share.liveSubtitle} />
      </div>
      <div
        className="ally-card"
        style={{ display: "flex", flexWrap: "wrap", gap: 24, alignItems: "center" }}
      >
        <div ref={qrRef}>
          <Qr link={published.link} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14, flex: 1, minWidth: 240 }}>
          <code
            className="ally-source"
            style={{
              fontSize: 14,
              padding: "10px 14px",
              whiteSpace: "normal",
              wordBreak: "break-all",
            }}
          >
            {published.link}
          </code>
          <div className="ally-btn-row">
            <PrimaryButton
              enterHint={COPY.frame.enterHint}
              onClick={() => void copyLink(published.link)}
            >
              {COPY.share.copyLink}
            </PrimaryButton>
          </div>
          <div className="ally-btn-row">
            <Button onClick={downloadQr}>{COPY.share.downloadQr}</Button>
            <Button
              onClick={() =>
                window.open(`https://wa.me/?text=${encodeURIComponent(share)}`, "_blank")
              }
            >
              {COPY.share.shareWhatsApp}
            </Button>
            <Button onClick={() => window.open(published.link, "_blank")}>
              {COPY.share.openPage}
            </Button>
          </div>
        </div>
      </div>
      <div
        className="ally-card ally-rise"
        style={{ display: "flex", flexDirection: "column", gap: 10 }}
      >
        <h2 className="ally-heading">{COPY.share.nextTitle}</h2>
        <p className="ally-body" style={{ margin: 0 }}>
          {COPY.share.nextBody}
        </p>
        <Button style={{ alignSelf: "flex-start" }} onClick={onConnectWhatsApp}>
          {COPY.share.nextButton}
        </Button>
      </div>
    </>
  );
};
