import React, { useEffect, useState } from "react";

import {
  Chip,
  FindingLine,
  Orb,
  PrimaryButton,
  ProgressBar,
  useEnterToSubmit,
} from "@components/v2";

import { ChoosePages } from "../ChoosePages";
import { COPY, fill } from "../copy";

import type { BotDraftView } from "../types";
import type { ReadingProgress } from "../useBotDraftSession";

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
