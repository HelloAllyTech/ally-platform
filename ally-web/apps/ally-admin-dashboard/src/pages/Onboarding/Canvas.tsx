import React, { useEffect, useRef, useState } from "react";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import QRCode from "qrcode";
import { toast } from "sonner";

import { AutoExpandableTextarea } from "@ally-ui-mono/ui-shared";
import { Button } from "@components";
import { ButtonVariant } from "@components/types";

import { COPY, fill } from "./copy";
import { Card, StatusPill } from "../WhatsAppBot/shared";

import type {
  BotDraftStep,
  BotDraftView,
  DesignCard,
  LearnedFact,
  LearnedSection,
  PatchOp,
  PublishResult,
} from "./types";
import type { ReadingProgress } from "./useBotDraftSession";

/** Steps in order, to say which sections a draft has reached. */
const ORDER: BotDraftStep[] = [
  "start",
  "reading",
  "learned",
  "safety",
  "gaps",
  "design",
  "building",
  "checkup",
  "try_it",
  "share",
  "published",
];
export const reached = (step: BotDraftStep, at: BotDraftStep) =>
  ORDER.indexOf(step) >= ORDER.indexOf(at);

/** A canvas section that fades in (and its heading takes focus) when its step starts. */
const Section: React.FC<{ id: string; children: React.ReactNode }> = ({ id, children }) => {
  const reduce = useReducedMotion();
  return (
    <motion.div
      key={id}
      data-testid={`canvas-${id}`}
      initial={reduce ? false : { opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      transition={{ duration: 0.18 }}
    >
      {children}
    </motion.div>
  );
};

// ── Reading ──────────────────────────────────────────────────────────────

export const ReadingCard: React.FC<{ view: BotDraftView; reading: ReadingProgress }> = ({
  view,
  reading,
}) => {
  const [slow, setSlow] = useState(false);
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
  return (
    <Card title={COPY.reading.title}>
      <div aria-live="polite" className="flex flex-col gap-3">
        <p className="text-sm text-typography-800">
          {done
            ? fill(COPY.reading.done, done)
            : read
              ? fill(COPY.reading.progress, { n: read })
              : fill(COPY.reading.status, { domain })}
        </p>
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-100"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={50}
          aria-valuenow={read}
        >
          <div
            className="h-full rounded-full bg-primary-600 transition-[width] duration-300"
            style={{ width: `${done ? 100 : Math.min(100, (read / 50) * 100)}%` }}
          />
        </div>
        {slow && !done && <p className="text-xs text-typography-600">{COPY.reading.takingLong}</p>}
        {reading.findings.length > 0 && (
          <ul className="flex flex-col gap-1">
            <AnimatePresence initial={false}>
              {reading.findings.map(line => (
                <motion.li
                  key={line}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-center gap-2 text-sm text-typography-700"
                >
                  <span aria-hidden className="text-success-600">
                    ✓
                  </span>
                  {line}
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </div>
    </Card>
  );
};

// ── What we learned ──────────────────────────────────────────────────────

const SECTIONS = Object.keys(COPY.learned.sections) as LearnedSection[];

const sourceLabel = (fact: LearnedFact) => {
  if (fact.byOwner || fact.sourceUrl === "owner") return COPY.learned.fromYou;
  return fact.sourceTitle || fact.sourceUrl;
};
const sourceHref = (fact: LearnedFact) =>
  /^https?:\/\//.test(fact.sourceUrl) ? fact.sourceUrl : null;

export const LearnedCard: React.FC<{
  view: BotDraftView;
  busy: boolean;
  onPatch: (target: "learned", ops: PatchOp[]) => Promise<boolean>;
  onConfirm: () => void;
}> = ({ view, busy, onPatch, onConfirm }) => {
  const [editing, setEditing] = useState<string | null>(null);
  const [text, setText] = useState("");
  const facts = view.learned.facts;
  const canConfirm = view.step === "learned";

  const save = async (index: number) => {
    if (await onPatch("learned", [{ op: "replace", path: `/facts/${index}/text`, value: text }])) {
      setEditing(null);
    }
  };

  return (
    <Card
      title={COPY.learned.title}
      subtitle={COPY.learned.subtitle}
      action={
        canConfirm ? (
          <Button variant={ButtonVariant.PRIMARY} onClick={onConfirm} disabled={busy}>
            {COPY.learned.confirm}
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-5">
        {SECTIONS.map(section => {
          const inSection = facts
            .map((fact, index) => ({ fact, index }))
            .filter(({ fact }) => fact.section === section);
          return (
            <div key={section} className="flex flex-col gap-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-typography-600">
                {COPY.learned.sections[section]}
              </h4>
              {inSection.length === 0 ? (
                <p className="text-sm text-typography-500">{COPY.learned.empty}</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {inSection.map(({ fact, index }) => (
                    <li
                      key={fact.id}
                      className="group flex flex-col gap-1 rounded-md border border-border-light px-3 py-2"
                    >
                      {editing === fact.id ? (
                        <div className="flex flex-col gap-2">
                          <AutoExpandableTextarea
                            id={`fact-${fact.id}`}
                            value={text}
                            onChange={setText}
                            maxLines={6}
                          />
                          <div className="flex gap-2">
                            <Button
                              variant={ButtonVariant.PRIMARY}
                              disabled={!text.trim()}
                              onClick={() => void save(index)}
                            >
                              {COPY.learned.save}
                            </Button>
                            <Button
                              variant={ButtonVariant.SECONDARY}
                              onClick={() => setEditing(null)}
                            >
                              {COPY.learned.cancel}
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <p className="text-sm text-typography-900">{fact.text}</p>
                      )}
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-typography-600">
                        <span className="truncate">{sourceLabel(fact)}</span>
                        {editing !== fact.id && (
                          <>
                            {sourceHref(fact) && (
                              <a
                                href={sourceHref(fact)!}
                                target="_blank"
                                rel="noreferrer"
                                className="underline"
                              >
                                {COPY.learned.viewSource}
                              </a>
                            )}
                            <button
                              type="button"
                              className="underline"
                              onClick={() => {
                                setEditing(fact.id);
                                setText(fact.text);
                              }}
                            >
                              {COPY.learned.edit}
                            </button>
                            <button
                              type="button"
                              className="underline"
                              onClick={() =>
                                void onPatch("learned", [{ op: "remove", path: `/facts/${index}` }])
                              }
                            >
                              {COPY.learned.remove}
                            </button>
                          </>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
};

// ── Safety ───────────────────────────────────────────────────────────────

export const SafetyCard: React.FC<{ view: BotDraftView }> = ({ view }) => {
  const [open, setOpen] = useState(false);
  const pack = view.safety;
  if (!pack) return null;
  const list = (title: string, items: string[]) =>
    items.length > 0 && (
      <div className="flex flex-col gap-1">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-typography-600">
          {title}
        </h4>
        <ul className="list-disc pl-5 text-sm text-typography-800">
          {items.map(item => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
    );
  return (
    <Card title={fill(COPY.safety.title, { "Pack name": pack.name })}>
      <p className="text-sm text-typography-700">
        {fill(COPY.safety.body, { industry: pack.industryLabel })}
      </p>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className="self-start text-sm underline text-typography-800"
      >
        {COPY.safety.link}
      </button>
      {open && (
        <div className="flex flex-col gap-3">
          {list(COPY.safety.always, pack.always)}
          {list(COPY.safety.never, pack.never)}
          {list(COPY.safety.atRisk, pack.atRisk)}
        </div>
      )}
    </Card>
  );
};

// ── Designs ──────────────────────────────────────────────────────────────

export const DesignCards: React.FC<{
  designs: DesignCard[];
  chosen: string | null;
  canChoose: boolean;
  onChoose: (id: string) => void;
}> = ({ designs, chosen, canChoose, onChoose }) => (
  <div className="grid gap-3 sm:grid-cols-2">
    {designs.map(design =>
      design.coming_soon ? (
        <section
          key={design.id}
          className="flex flex-col gap-2 rounded-md border border-dashed border-border-light p-4"
        >
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-base text-typography-700">{COPY.designs.comingSoonTitle}</h3>
            <StatusPill tone="neutral">{COPY.designs.comingSoonBadge}</StatusPill>
          </div>
          <p className="text-sm text-typography-600">{COPY.designs.comingSoonBody}</p>
        </section>
      ) : (
        <section
          key={design.id}
          className={`flex flex-col gap-3 rounded-md border p-4 ${
            chosen === design.id ? "border-primary-600" : "border-border-light"
          }`}
        >
          <h3 className="text-base text-typography-900 font-secondary">{design.title}</h3>
          <p className="text-sm text-typography-700">
            <span className="font-semibold">{COPY.designs.bestFor}</span> {design.best_for}
          </p>
          <div className="text-sm text-typography-700">
            <span className="font-semibold">{COPY.designs.will}</span>
            <ul className="list-disc pl-5">
              {design.will.map(item => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <div className="text-sm text-typography-700">
            <span className="font-semibold">{COPY.designs.wont}</span>
            <ul className="list-disc pl-5">
              {design.wont.map(item => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <div className="flex flex-col gap-1 rounded bg-neutral-50 p-2 text-xs">
            {design.sample.map((line, i) => (
              <p
                key={i}
                className={line.from === "visitor" ? "text-typography-600" : "text-typography-900"}
              >
                {line.text}
              </p>
            ))}
          </div>
          {canChoose && (
            <Button
              variant={chosen === design.id ? ButtonVariant.PRIMARY : ButtonVariant.SECONDARY}
              onClick={() => onChoose(design.id)}
            >
              {COPY.designs.choose}
            </Button>
          )}
        </section>
      ),
    )}
  </div>
);

// ── Building ─────────────────────────────────────────────────────────────

export const BuildingCard: React.FC<{ done: boolean }> = ({ done }) => {
  const [ticked, setTicked] = useState(done ? COPY.building.steps.length : 0);
  useEffect(() => {
    if (done) {
      setTicked(COPY.building.steps.length);
      return undefined;
    }
    // While the builder writes, the steps tick at a steady pace, stopping short of the last until
    // it has really finished.
    const timer = setInterval(
      () => setTicked(n => Math.min(n + 1, COPY.building.steps.length - 1)),
      2500,
    );
    return () => clearInterval(timer);
  }, [done]);
  return (
    <Card title={COPY.building.title}>
      <ol className="flex flex-col gap-2" aria-live="polite">
        {COPY.building.steps.map((label, i) => (
          <li key={label} className="flex items-center gap-2 text-sm">
            <span
              aria-hidden
              className={`flex h-5 w-5 items-center justify-center rounded-full text-xs ${
                i < ticked ? "bg-success-600 text-white" : "bg-neutral-100 text-typography-500"
              }`}
            >
              {i < ticked ? "✓" : i + 1}
            </span>
            <span className={i < ticked ? "text-typography-900" : "text-typography-600"}>
              {label}
            </span>
          </li>
        ))}
      </ol>
    </Card>
  );
};

// ── Your assistant ───────────────────────────────────────────────────────

const EditableText: React.FC<{
  label: string;
  value: string;
  path: string;
  multiline?: boolean;
  onPatch: (target: "draft", ops: PatchOp[]) => Promise<boolean>;
}> = ({ label, value, path, onPatch }) => {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-typography-600">
          {label}
        </h4>
        {!editing && (
          <button
            type="button"
            className="text-xs underline text-typography-700"
            onClick={() => {
              setText(value);
              setEditing(true);
            }}
          >
            {COPY.learned.edit}
          </button>
        )}
      </div>
      {editing ? (
        <div className="flex flex-col gap-2">
          <AutoExpandableTextarea
            id={`edit-${path}`}
            value={text}
            onChange={setText}
            maxLines={8}
          />
          <div className="flex gap-2">
            <Button
              variant={ButtonVariant.PRIMARY}
              disabled={!text.trim()}
              onClick={async () => {
                if (await onPatch("draft", [{ op: "replace", path, value: text.trim() }])) {
                  setEditing(false);
                }
              }}
            >
              {COPY.learned.save}
            </Button>
            <Button variant={ButtonVariant.SECONDARY} onClick={() => setEditing(false)}>
              {COPY.learned.cancel}
            </Button>
          </div>
        </div>
      ) : (
        <p className="whitespace-pre-wrap text-sm text-typography-900">
          {value || <span className="text-typography-500">{COPY.assistant.empty}</span>}
        </p>
      )}
    </div>
  );
};

const ListField: React.FC<{ label: string; items: string[] }> = ({ label, items }) => (
  <div className="flex flex-col gap-1">
    <h4 className="text-xs font-semibold uppercase tracking-wide text-typography-600">{label}</h4>
    {items.length ? (
      <ul className="list-disc pl-5 text-sm text-typography-900">
        {items.map(item => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    ) : (
      <p className="text-sm text-typography-500">{COPY.assistant.empty}</p>
    )}
  </div>
);

export const AssistantCard: React.FC<{
  view: BotDraftView;
  onPatch: (target: "draft", ops: PatchOp[]) => Promise<boolean>;
}> = ({ view, onPatch }) => {
  const d = view.draft;
  return (
    <Card title={COPY.assistant.title}>
      <div className="flex flex-col gap-4">
        <EditableText
          label={COPY.assistant.name}
          value={d.assistantName}
          path="/assistantName"
          onPatch={onPatch}
        />
        <EditableText
          label={COPY.assistant.introduction}
          value={d.introduction}
          path="/introduction"
          onPatch={onPatch}
        />
        <ListField label={COPY.assistant.topics} items={d.topics} />
        <ListField label={COPY.assistant.suggested} items={d.suggestedQuestions} />
        {d.prechat.length > 0 && (
          <ListField label={COPY.assistant.prechat} items={d.prechat.map(f => f.label)} />
        )}
        <EditableText
          label={COPY.assistant.decline}
          value={d.declineText}
          path="/declineText"
          onPatch={onPatch}
        />
        {view.safety && (
          <div className="flex flex-col gap-1">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-typography-600">
              {COPY.assistant.safety}
            </h4>
            <p className="text-sm text-typography-900">
              {fill(COPY.safety.title, { "Pack name": view.safety.name })}
            </p>
          </div>
        )}
      </div>
    </Card>
  );
};

// ── Share ────────────────────────────────────────────────────────────────

type Access = "public" | "organisation" | "invite";

const parseEmails = (text: string) =>
  text
    .split(/[\s,;]+/)
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);

const copyLink = async (link: string) => {
  try {
    await navigator.clipboard.writeText(link);
    toast.success(COPY.share.copied);
  } catch {
    toast.error(COPY.problems.generic);
  }
};

const Qr: React.FC<{ link: string }> = ({ link }) => {
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
    <img src={src} alt="" className="h-36 w-36" data-testid="share-qr" />
  ) : (
    <div className="h-36 w-36 rounded bg-neutral-100" />
  );
};

export const ShareCard: React.FC<{
  view: BotDraftView;
  publicAllowed: boolean;
  published: PublishResult | null;
  publishing: boolean;
  onPublish: (access: Access, emails: string[]) => void;
  onConnectWhatsApp: () => void;
}> = ({ view, publicAllowed, published, publishing, onPublish, onConnectWhatsApp }) => {
  const [access, setAccess] = useState<Access>(view.draft.access.mode ?? "invite");
  const [emails, setEmails] = useState(view.draft.access.emails.join(", "));
  const qrRef = useRef<HTMLDivElement>(null);

  if (published) {
    const business = view.draft.name;
    const share = fill(COPY.share.whatsAppText, { business, link: published.link });
    const downloadQr = () => {
      const img = qrRef.current?.querySelector("img");
      if (!img) return;
      const a = document.createElement("a");
      a.href = img.src;
      a.download = `${published.slug}-qr.png`;
      a.click();
    };
    return (
      <div className="flex flex-col gap-4">
        <Card title={COPY.share.liveTitle} subtitle={COPY.share.liveSubtitle}>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <div ref={qrRef}>
              <Qr link={published.link} />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              <code className="break-all rounded border border-border-light bg-neutral-50 px-2 py-1.5 text-xs">
                {published.link}
              </code>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant={ButtonVariant.PRIMARY}
                  onClick={() => void copyLink(published.link)}
                >
                  {COPY.share.copyLink}
                </Button>
                <Button variant={ButtonVariant.SECONDARY} onClick={downloadQr}>
                  {COPY.share.downloadQr}
                </Button>
                <Button
                  variant={ButtonVariant.SECONDARY}
                  onClick={() =>
                    window.open(`https://wa.me/?text=${encodeURIComponent(share)}`, "_blank")
                  }
                >
                  {COPY.share.shareWhatsApp}
                </Button>
                <Button
                  variant={ButtonVariant.SECONDARY}
                  onClick={() => window.open(published.link, "_blank")}
                >
                  {COPY.share.openPage}
                </Button>
              </div>
            </div>
          </div>
        </Card>
        <Card title={COPY.share.nextTitle} subtitle={COPY.share.nextBody}>
          <Button
            variant={ButtonVariant.SECONDARY}
            className="self-start"
            onClick={onConnectWhatsApp}
          >
            {COPY.share.nextButton}
          </Button>
        </Card>
      </div>
    );
  }

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
  const ready = access !== "invite" || list.length > 0;
  return (
    <Card title={COPY.share.title}>
      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">{COPY.share.title}</legend>
        {options.map(option => (
          <label
            key={option.id}
            className={`flex items-start gap-3 rounded-md border p-3 ${
              access === option.id ? "border-primary-600" : "border-border-light"
            } ${option.disabled ? "opacity-60" : "cursor-pointer"}`}
          >
            <input
              type="radio"
              name="access"
              className="mt-1"
              checked={access === option.id}
              disabled={option.disabled}
              onChange={() => setAccess(option.id)}
            />
            <span className="flex flex-col">
              <span className="text-sm text-typography-900">{option.label}</span>
              <span className="text-xs text-typography-600">{option.help}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {access === "invite" && (
        <div className="flex flex-col gap-1">
          <label htmlFor="invite-emails" className="text-sm text-typography-800">
            {COPY.share.emailsLabel}
          </label>
          <AutoExpandableTextarea
            id="invite-emails"
            value={emails}
            onChange={setEmails}
            placeholder={COPY.share.emailsPlaceholder}
            maxLines={6}
          />
          <p className="text-xs text-typography-600">{COPY.share.emailsHelp}</p>
        </div>
      )}
      <Button
        variant={ButtonVariant.PRIMARY}
        className="self-start"
        disabled={!ready || publishing}
        onClick={() => onPublish(access, access === "invite" ? list : [])}
      >
        {publishing ? COPY.share.publishing : COPY.share.publish}
      </Button>
    </Card>
  );
};

export { Section };
