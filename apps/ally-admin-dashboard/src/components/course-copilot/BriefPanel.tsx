import React from "react";

import { CheckCircle } from "@icons";

import { en } from "@constants";
import type { CourseBrief, CourseBriefPracticeSlot, CourseBriefReadiness } from "@types";
import { asAgentText, asAgentTextList } from "@utils";

import {
  asArray,
  asNumber,
  formatElapsed,
  formatMinutes,
  humanizeToken,
} from "./courseCopilotFormat";

export interface BriefPanelProps {
  /** Live from `brief` frames while a turn streams; otherwise the session's saved brief. */
  brief?: CourseBrief | null;
  readiness?: CourseBriefReadiness | null;
}

const text = (value: unknown): string => asAgentText(value).trim();

/** Label for a closed vocabulary the agent filled in, falling back to the raw token for one we do not know. */
const lookup = (labels: Record<string, string>, key: unknown): string => {
  const token = text(key);
  return token ? (labels[token] ?? humanizeToken(token)) : "";
};

interface RowProps {
  label: string;
  children: React.ReactNode;
}

const Row: React.FC<RowProps> = ({ label, children }) => (
  <div className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-sm">
    <dt className="text-xs text-typography-700">{label}</dt>
    <dd className="min-w-0 break-words text-typography-900">{children}</dd>
  </div>
);

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="space-y-2">
    <h3 className="text-xs font-semibold uppercase tracking-wide text-typography-700">{title}</h3>
    {children}
  </section>
);

const Chip: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="shrink-0 rounded-full bg-secondary-50 px-2 py-0.5 text-xs text-typography-900">
    {children}
  </span>
);

const BulletList: React.FC<{ items: string[] }> = ({ items }) => (
  <ul className="list-disc space-y-0.5 pl-5 text-sm text-typography-900">
    {items.map((item, index) => (
      <li key={`${index}-${item}`}>{item}</li>
    ))}
  </ul>
);

/**
 * The course brief as the interview builds it: read-only, filling in live. It is what
 * every later question — and the blueprint — stands on, so the trainer can see what the
 * copilot has understood and correct it in chat.
 *
 * A section with nothing to say renders nothing at all (no "—" rows): an early brief is
 * mostly empty, and a page of dashes would read as broken rather than as just started.
 * Per Stacks, "Progressive Disclosure and Contextual Relevance in Agent Interfaces": show
 * what is relevant now and let the rest appear as it becomes so.
 */
export const BriefPanel: React.FC<BriefPanelProps> = ({ brief, readiness }) => {
  const strings = en.courseCopilotPane.brief;
  const source: CourseBrief = brief && typeof brief === "object" ? brief : {};

  const seed = text(source.seed);

  const audience = source.audience;
  const audienceRows: [string, string][] = (
    [
      [strings.audience.who, text(audience?.who)],
      [strings.audience.priorExperience, text(audience?.priorExperience)],
      [strings.audience.applicationContext, text(audience?.applicationContext)],
      [strings.audience.groupNote, text(audience?.groupNote)],
    ] as [string, string][]
  ).filter(([, value]) => value);

  const terminal = text(source.outcomes?.terminal);
  const enabling = asAgentTextList(source.outcomes?.enabling);
  const competencies = asAgentTextList(source.competencyNames);
  const helpful = asAgentTextList(source.behaviours?.helpful);
  const unhelpful = asAgentTextList(source.behaviours?.unhelpful);

  const assessment = source.assessment;
  const assessmentKind = lookup(strings.assessment.kind, assessment?.kind);
  const assessmentNote = text(assessment?.note);
  const threshold = asNumber(assessment?.threshold);

  const shape = source.shape;
  const durationMinutes = asNumber(shape?.durationMinutes);
  const sectionCount = asNumber(shape?.sections);
  const weight = lookup(strings.shape.weights, shape?.practiceWeight);
  const components = asArray<unknown>(shape?.components)
    .map(component => lookup(strings.shape.components, component))
    .filter(Boolean);
  const tone = text(shape?.tone);
  const readingLevel = text(shape?.readingLevel);
  const languageCount = asArray<unknown>(shape?.languageIds).length;
  const hasShape =
    durationMinutes !== null ||
    sectionCount !== null ||
    weight ||
    components.length > 0 ||
    tone ||
    readingLevel ||
    languageCount > 0;

  const practice = asArray<CourseBriefPracticeSlot>(source.practice).filter(
    slot => slot && typeof slot === "object",
  );

  const cover = lookup(strings.look.cover, source.look?.cover);
  const articleImages = lookup(strings.look.articleImages, source.look?.articleImages);
  const coverImageUrl = text(source.look?.coverImageUrl);
  const hasLook = Boolean(cover || articleImages || coverImageUrl);

  const videos = asArray<NonNullable<CourseBrief["videoUrls"]>[number]>(source.videoUrls).filter(
    video => video && typeof video === "object",
  );
  const notes = asAgentTextList(source.notes);

  const hasContent =
    seed ||
    audienceRows.length > 0 ||
    terminal ||
    enabling.length > 0 ||
    competencies.length > 0 ||
    helpful.length > 0 ||
    unhelpful.length > 0 ||
    assessmentKind ||
    assessmentNote ||
    threshold !== null ||
    hasShape ||
    practice.length > 0 ||
    hasLook ||
    videos.length > 0 ||
    notes.length > 0;

  const missing = asAgentTextList(readiness?.missing);

  if (!hasContent) {
    return (
      <div className="px-4 py-6">
        <h2 className="text-base font-semibold text-typography-900">{strings.heading}</h2>
        <p className="mt-2 text-sm text-typography-700">{strings.empty}</p>
      </div>
    );
  }

  return (
    <div className="space-y-5 px-4 py-4">
      <header className="space-y-2">
        <h2 className="text-base font-semibold text-typography-900">{strings.heading}</h2>
        {readiness?.ready ? (
          <p className="inline-flex items-center gap-1.5 rounded-full bg-success-50 px-2.5 py-1 text-xs font-medium text-success-600">
            <CheckCircle className="h-3.5 w-3.5" />
            {strings.ready}
          </p>
        ) : (
          missing.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="font-medium text-typography-800">{strings.stillNeeded}</span>
              <ul className="flex flex-wrap gap-1.5" aria-label={strings.stillNeeded}>
                {missing.map(name => (
                  <li
                    key={name}
                    className="rounded-full bg-warning-50 px-2 py-0.5 text-warning-text"
                  >
                    {name}
                  </li>
                ))}
              </ul>
            </div>
          )
        )}
      </header>

      {seed && (
        <Section title={strings.sections.seed}>
          <p className="border-l-2 border-neutral-200 pl-3 text-sm italic text-typography-800">
            {seed}
          </p>
        </Section>
      )}

      {audienceRows.length > 0 && (
        <Section title={strings.sections.audience}>
          <dl className="space-y-1.5">
            {audienceRows.map(([label, value]) => (
              <Row key={label} label={label}>
                {value}
              </Row>
            ))}
          </dl>
        </Section>
      )}

      {(terminal || enabling.length > 0) && (
        <Section title={strings.sections.outcomes}>
          {terminal && (
            <div className="space-y-0.5">
              <p className="text-xs text-typography-700">{strings.outcomes.terminal}</p>
              <p className="text-sm font-medium text-typography-900">{terminal}</p>
            </div>
          )}
          {enabling.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs text-typography-700">{strings.outcomes.enabling}</p>
              <ol className="space-y-1">
                {enabling.map((outcome, index) => (
                  <li key={`${index}-${outcome}`} className="flex items-start gap-2 text-sm">
                    <span className="mt-0.5 shrink-0 rounded bg-primary-50 px-1.5 py-0.5 text-xs font-medium text-primary-700">
                      {`O${index + 1}`}
                    </span>
                    <span className="min-w-0 flex-1 text-typography-900">{outcome}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </Section>
      )}

      {competencies.length > 0 && (
        <Section title={strings.sections.competencies}>
          <ul className="flex flex-wrap gap-1.5">
            {competencies.map(name => (
              <li key={name}>
                <Chip>{name}</Chip>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {(helpful.length > 0 || unhelpful.length > 0) && (
        <Section title={strings.sections.behaviours}>
          {helpful.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs text-typography-700">{strings.behaviours.helpful}</p>
              <BulletList items={helpful} />
            </div>
          )}
          {unhelpful.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs text-typography-700">{strings.behaviours.unhelpful}</p>
              <BulletList items={unhelpful} />
            </div>
          )}
        </Section>
      )}

      {(assessmentKind || assessmentNote || threshold !== null) && (
        <Section title={strings.sections.assessment}>
          <dl className="space-y-1.5">
            {assessmentKind && <Row label={strings.assessment.how}>{assessmentKind}</Row>}
            {threshold !== null && (
              <Row label={strings.assessment.threshold}>
                {strings.assessment.passMark(threshold)}
              </Row>
            )}
            {assessmentNote && <Row label={strings.assessment.note}>{assessmentNote}</Row>}
          </dl>
        </Section>
      )}

      {hasShape && (
        <Section title={strings.sections.shape}>
          <dl className="space-y-1.5">
            {durationMinutes !== null && (
              <Row label={strings.shape.duration}>{formatMinutes(durationMinutes)}</Row>
            )}
            {sectionCount !== null && <Row label={strings.shape.sections}>{sectionCount}</Row>}
            {weight && <Row label={strings.shape.weight}>{weight}</Row>}
            {components.length > 0 && (
              <Row label={strings.shape.componentsLabel}>
                <span className="flex flex-wrap gap-1.5">
                  {components.map(component => (
                    <Chip key={component}>{component}</Chip>
                  ))}
                </span>
              </Row>
            )}
            {tone && <Row label={strings.shape.tone}>{tone}</Row>}
            {readingLevel && <Row label={strings.shape.readingLevel}>{readingLevel}</Row>}
            {languageCount > 0 && (
              <Row label={strings.shape.languages}>
                {strings.shape.languageCount(languageCount)}
              </Row>
            )}
          </dl>
        </Section>
      )}

      {practice.length > 0 && (
        <Section title={strings.sections.practice}>
          <ol className="space-y-2">
            {practice.map((slot, index) => {
              const personaBrief = text(slot.personaBrief);
              const taskClass = text(slot.taskClass);
              const minScore = asNumber(slot.minScore);
              const slotNumber = asNumber(slot.slot) ?? index + 1;
              return (
                <li
                  key={`${slotNumber}-${index}`}
                  className="space-y-1 rounded-md border border-neutral-200 p-2.5"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-typography-900">
                      {strings.practice.slot(slotNumber)}
                    </span>
                    {slot.source === "library" && <Chip>{strings.practice.library}</Chip>}
                    {slot.source === "new" && <Chip>{strings.practice.new}</Chip>}
                    {minScore !== null && (
                      <span className="text-xs text-typography-700">
                        {strings.practice.minScore(minScore)}
                      </span>
                    )}
                  </div>
                  {taskClass && <p className="text-sm text-typography-900">{taskClass}</p>}
                  {personaBrief && <p className="text-xs text-typography-700">{personaBrief}</p>}
                  {slot.saveCharacter && (
                    <p className="text-xs text-typography-700">{strings.practice.savesCharacter}</p>
                  )}
                </li>
              );
            })}
          </ol>
        </Section>
      )}

      {hasLook && (
        <Section title={strings.sections.look}>
          <dl className="space-y-1.5">
            {cover && <Row label={strings.look.coverLabel}>{cover}</Row>}
            {articleImages && <Row label={strings.look.articleImagesLabel}>{articleImages}</Row>}
          </dl>
          {coverImageUrl && (
            <img
              src={coverImageUrl}
              alt=""
              className="h-24 w-40 rounded-md border border-neutral-200 object-cover"
            />
          )}
        </Section>
      )}

      {videos.length > 0 && (
        <Section title={strings.sections.videos}>
          <ul className="space-y-1.5">
            {videos.map((video, index) => {
              const url = text(video.url);
              const seconds = asNumber(video.durationSeconds);
              return (
                <li key={`${index}-${url}`} className="flex items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate text-typography-900" title={url}>
                    {text(video.title) || url}
                  </span>
                  {video.source && <Chip>{lookup(strings.videos.sources, video.source)}</Chip>}
                  {seconds !== null && (
                    <span className="shrink-0 text-xs text-typography-700">
                      {formatElapsed(seconds * 1000)}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      {notes.length > 0 && (
        <Section title={strings.sections.notes}>
          <BulletList items={notes} />
        </Section>
      )}
    </div>
  );
};
