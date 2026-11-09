import React, { useEffect, useId, useMemo, useState } from "react";

import {
  useCorrectFactMutation,
  useCreatePrivateChatbotDocumentMutation,
  useGetChatbotDocumentQuery,
  useGetChatbotDocumentsQuery,
  useUpdateChatbotDocumentMutation,
} from "@api";
import { Button, SourceChip } from "@components/v2";
import type { HomeFact } from "@types";

import { COPY } from "../../Onboarding/copy";
import { KnowledgeTab } from "../../WhatsAppBot/KnowledgeTab";
import { UnansweredTab } from "../../WhatsAppBot/UnansweredTab";
import { HOME } from "../copy";
import { Collapsed, Group, SectionHead } from "../fields";

import type { SectionProps } from "./props";

const t = HOME.knows;
/** The Owner notes document onboarding writes (ally-be `OWNER_NOTES_TITLE`). */
export const OWNER_NOTES_TITLE = "Owner notes";
const SECTION_ORDER = Object.keys(COPY.learned.sections) as (keyof typeof COPY.learned.sections)[];

const message = (error: unknown): string | undefined => {
  const data = (error as { data?: { message?: unknown } })?.data;
  return typeof data?.message === "string" ? data.message : undefined;
};

const sourceOf = (fact: HomeFact): { label: string; href?: string | null } => {
  if (fact.correction) return { label: t.corrected };
  if (fact.byOwner || fact.sourceUrl === "owner") return { label: COPY.learned.fromYou };
  return { label: fact.sourceTitle || hostOf(fact.sourceUrl), href: fact.sourceUrl };
};

const hostOf = (url: string): string => {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname.replace(/^www\./, "")}${parsed.pathname === "/" ? "" : parsed.pathname}`;
  } catch {
    return url;
  }
};

/** One fact: its text and source; "Correct this" replaces it for the assistant (§4.1.1). */
const Fact: React.FC<{ botId: string; fact: HomeFact; canEdit: boolean }> = ({
  botId,
  fact,
  canEdit,
}) => {
  const [correct, state] = useCorrectFactMutation();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(fact.text);
  const [showOriginal, setShowOriginal] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const source = sourceOf(fact);

  const save = async () => {
    setError(null);
    try {
      const result = await correct({
        id: botId,
        factId: fact.id,
        text: value.trim(),
        version: fact.version,
      }).unwrap();
      setEditing(false);
      setNote(result.appliedTo === "page" ? t.correctedPage : t.correctedNotes);
    } catch (failure) {
      setError(message(failure) ?? HOME.saving.failed);
    }
  };

  return (
    <li className="ally-learned" data-testid={`fact-${fact.id}`}>
      {editing ? (
        <form
          className="ally-field"
          onSubmit={event => {
            event.preventDefault();
            if (value.trim()) void save();
          }}
        >
          <label htmlFor={id}>{t.correctionLabel}</label>
          <textarea
            id={id}
            className="ally-input"
            value={value}
            autoFocus
            maxLength={500}
            onChange={event => setValue(event.target.value)}
            onKeyDown={event => {
              if (event.key === "Escape") setEditing(false);
            }}
          />
          <div className="ally-btn-row">
            <Button type="submit" variant="primary" disabled={!value.trim() || state.isLoading}>
              {t.saveCorrection}
            </Button>
            <Button onClick={() => setEditing(false)}>{t.cancel}</Button>
          </div>
        </form>
      ) : (
        <p className="ally-learned__text">{fact.text}</p>
      )}
      {showOriginal && fact.correction && (
        <p className="ally-small ally-home__original">
          <span className="ally-label">{t.original}</span> {fact.correction.originalText}
        </p>
      )}
      <div className="ally-learned__meta">
        <SourceChip label={source.label} href={source.href} />
        {!editing && fact.correction && (
          <button type="button" className="ally-link" onClick={() => setShowOriginal(s => !s)}>
            {showOriginal ? t.hideOriginal : t.showOriginal}
          </button>
        )}
        {!editing && canEdit && (
          <button
            type="button"
            className="ally-link"
            onClick={() => {
              setValue(fact.text);
              setNote(null);
              setEditing(true);
            }}
          >
            {t.correct}
          </button>
        )}
      </div>
      {note && (
        <p className="ally-small" role="status">
          {note}
        </p>
      )}
      {error && (
        <p className="ally-error" role="alert">
          {error}
        </p>
      )}
    </li>
  );
};

/** The Owner notes document, edited in place; saved (and re-read by the assistant) on blur. */
const Notes: React.FC<{ botId: string; canEdit: boolean }> = ({ botId, canEdit }) => {
  const { data: documents } = useGetChatbotDocumentsQuery(botId);
  const notesRow = documents?.find(d => d.private && !d.archived && d.title === OWNER_NOTES_TITLE);
  const { data: notes } = useGetChatbotDocumentQuery(
    { id: botId, documentId: notesRow?.id ?? "" },
    { skip: !notesRow },
  );
  const [update] = useUpdateChatbotDocumentMutation();
  const [create] = useCreatePrivateChatbotDocumentMutation();
  const [value, setValue] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const id = useId();
  const stored = notes?.rawText ?? "";
  useEffect(() => setValue(null), [stored]);
  const text = value ?? stored;

  const save = async () => {
    if (value === null || value.trim() === stored.trim()) return;
    setStatus(HOME.saving.saving);
    try {
      if (notesRow) {
        await update({ id: botId, documentId: notesRow.id, text: value }).unwrap();
      } else if (value.trim()) {
        await create({
          id: botId,
          title: OWNER_NOTES_TITLE,
          sourceType: "paste",
          text: value,
        }).unwrap();
      }
      setStatus(HOME.saving.saved);
    } catch (failure) {
      setStatus(message(failure) ?? HOME.saving.failed);
    }
  };

  return (
    <div className="ally-field">
      <label htmlFor={id} className="ally-sr-only">
        {t.notes}
      </label>
      <textarea
        id={id}
        className="ally-input"
        rows={6}
        value={text}
        disabled={!canEdit}
        placeholder={t.notesPlaceholder}
        onChange={event => setValue(event.target.value)}
        onBlur={() => void save()}
      />
      {status && (
        <span className="ally-small" aria-live="polite">
          {status}
        </span>
      )}
    </div>
  );
};

const statusOf = (status: string): string =>
  status === "indexed" ? t.ready : status === "failed" ? t.failed : t.reading;

/** The documents it answers from, one line each: name and whether it's ready. */
const Documents: React.FC<{ botId: string }> = ({ botId }) => {
  const { data: documents } = useGetChatbotDocumentsQuery(botId);
  const list = (documents ?? []).filter(d => !d.archived);
  return (
    <ul className="ally-home__docs">
      {list.map(document => (
        <li key={document.id}>
          <span>{document.title}</span>
          <span
            className={`ally-badge ally-home__doc-status ally-home__doc-status--${document.status}`}
          >
            {statusOf(document.status)}
          </span>
        </li>
      ))}
    </ul>
  );
};

/**
 * What the assistant answers from (chunk 20d): the facts read from the website (each correctable),
 * the owner's notes, the documents, and the questions it couldn't answer.
 */
export const KnowsSection: React.FC<SectionProps> = ({ bot, home, canEdit }) => {
  const groups = useMemo(() => {
    const bySection = new Map<string, HomeFact[]>();
    for (const fact of home.facts) {
      bySection.set(fact.section, [...(bySection.get(fact.section) ?? []), fact]);
    }
    return SECTION_ORDER.filter(s => bySection.has(s)).map(s => ({
      id: s,
      label: COPY.learned.sections[s],
      facts: bySection.get(s)!,
    }));
  }, [home.facts]);

  return (
    <>
      <SectionHead title={HOME.sections.knows} subtitle={HOME.subtitles.knows} />

      <Group title={t.website} testId="knows-website">
        {groups.length === 0 ? (
          <p className="ally-empty">{t.noFacts}</p>
        ) : (
          groups.map(group => (
            <section key={group.id} className="ally-learned-group">
              <h4 className="ally-label">{group.label}</h4>
              <ul className="ally-home__facts">
                {group.facts.map(fact => (
                  <Fact key={fact.id} botId={bot.id} fact={fact} canEdit={canEdit} />
                ))}
              </ul>
            </section>
          ))
        )}
      </Group>

      <Group title={t.notes} hint={t.notesHint} testId="knows-notes">
        <Notes botId={bot.id} canEdit={canEdit} />
      </Group>

      <Group title={t.documents} hint={t.documentsHint} testId="knows-documents">
        <Documents botId={bot.id} />
        <Collapsed summary={t.manageDocuments}>
          <div className="ally-home__classic">
            <KnowledgeTab bot={bot} canEdit={canEdit} />
          </div>
        </Collapsed>
      </Group>

      <Group title={t.needsYou} testId="knows-unanswered">
        {bot.stats.openUnanswered > 0 ? (
          <div className="ally-home__classic">
            <UnansweredTab />
          </div>
        ) : (
          <p className="ally-empty">{HOME.overview.allClear}</p>
        )}
      </Group>
    </>
  );
};
