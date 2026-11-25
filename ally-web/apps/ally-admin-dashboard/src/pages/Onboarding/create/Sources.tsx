import React, { useRef, useState } from "react";

import { useGetBotDraftQuery, useGetBotDraftSourcesQuery, useGetChatbotDocumentsQuery } from "@api";
import type { PendingChange } from "@api";
import { Button } from "@components/v2";

import { BUILD_COPY, PAUSED_REASON_COPY, PausedKind, pausedKindOf } from "./copy";
import { crawlFailureText, isCreditsRequired, codeOf, messageOf, isInternalSource } from "./logic";
import { SOURCE_ACCEPT, filesOk } from "./useSources";
import { TF1_COPY } from "../../AssistantHome/copy/tf1";
import { Review as KnowledgeReview } from "../../AssistantHome/sections/KnowledgeTools";
import { fill } from "../copy";

const T = BUILD_COPY.form;

/** Documents staged on a live chatbot, from the pending "sources" row. */
const stagedOf = (pending: PendingChange[]): { id: string; title: string; status: string }[] => {
  const row = pending.find(p => p.field === "sources");
  return Array.isArray(row?.working)
    ? (row!.working as { id: string; title: string; status: string }[])
    : [];
};

/**
 * The form's Sources section: what the chatbot reads from (website and documents, each with its
 * status), and adding more. Adding needs AI (reading and indexing), so it is off at $0.
 */
export const SourcesSection: React.FC<{
  draftId: string;
  chatbotId: string | null;
  pending: PendingChange[];
  creditsOut: boolean;
  disabled?: boolean;
  addAddress: (address: string) => Promise<unknown>;
  addFiles: (files: File[]) => Promise<unknown>;
  onCreditsOut: () => void;
}> = ({
  draftId,
  chatbotId,
  pending,
  creditsOut,
  disabled,
  addAddress,
  addFiles,
  onCreditsOut,
}) => {
  const sources = useGetBotDraftSourcesQuery(draftId, { pollingInterval: 5000 });
  const documents = useGetChatbotDocumentsQuery(chatbotId ?? "", {
    skip: !chatbotId,
    pollingInterval: 8000,
  });
  const draft = useGetBotDraftQuery(draftId);
  const sitePaused: PausedKind | null = draft.data?.crawl?.pausedOutOfCredits
    ? (draft.data.crawl.pausedReason ?? "out_of_credits")
    : null;
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const off = Boolean(disabled) || creditsOut;
  const staged = stagedOf(pending);
  // TF1 round 2: the setup's own working documents are not sources the owner added.
  const attached = (documents.data ?? []).filter(
    d => !d.archived && !d.isGlobal && !isInternalSource(d.title),
  );
  const crawl = sources.data?.crawl;
  const heldIds = attached
    .filter(d => d.status === "needs_review")
    .map(d => d.id)
    .join(",");

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setProblem(null);
    try {
      const result = (await action()) as {
        failure?: { errorCode: string; message: string } | null;
      };
      if (result?.failure)
        setProblem(crawlFailureText(result.failure.errorCode, result.failure.message));
      void sources.refetch();
      void documents.refetch();
      return true;
    } catch (error) {
      if (isCreditsRequired(error)) onCreditsOut();
      setProblem(
        isCreditsRequired(error)
          ? BUILD_COPY.credits.field
          : crawlFailureText(codeOf(error), messageOf(error)),
      );
      return false;
    } finally {
      setBusy(false);
    }
  };

  const empty = !crawl?.domain && attached.length === 0 && staged.length === 0;
  // One note per reason paused here; only out of credits and no billing account ask for Ally.
  const pausedKinds = new Set<PausedKind>(
    [sitePaused, ...attached.map(d => pausedKindOf(d.statusMessage))].filter(
      (kind): kind is PausedKind => kind !== null,
    ),
  );
  const pausedNotes = [...pausedKinds]
    .map(kind => PAUSED_REASON_COPY[kind].note)
    .filter((note): note is string => Boolean(note));

  return (
    <div className="ally-build__sources" data-testid="build-sources">
      {empty && <p className="ally-small">{T.sourcesEmpty}</p>}
      <ul className="ally-build__list">
        {crawl?.domain && (
          <li data-testid="source-website">
            <span>{crawl.domain}</span>
            <span className="ally-small">
              {sitePaused
                ? PAUSED_REASON_COPY[sitePaused].site
                : crawl.status === "running"
                  ? fill(BUILD_COPY.copilot.reading, { address: crawl.domain })
                  : crawl.failure
                    ? crawlFailureText(crawl.failure.errorCode, crawl.failure.message)
                    : fill(T.pagesRead, { n: crawl.pagesRead })}
            </span>
          </li>
        )}
        {(sources.data?.queue ?? []).map(q => (
          <li key={q}>
            <span>{q}</span>
            <span className="ally-small">{fill(BUILD_COPY.copilot.queued, { address: q })}</span>
          </li>
        ))}
        {attached.map(d => (
          <li key={d.id}>
            <span>{d.title}</span>
            <span
              className="ally-small"
              data-testid={pausedKindOf(d.statusMessage) ? "source-paused" : undefined}
            >
              {(() => {
                const kind = pausedKindOf(d.statusMessage);
                return kind
                  ? PAUSED_REASON_COPY[kind].document
                  : d.status === "needs_review"
                    ? TF1_COPY.sources.held
                    : (T.fileStatus[d.status] ?? d.status);
              })()}
            </span>
          </li>
        ))}
        {staged.map(d => (
          <li key={d.id} data-testid="source-staged">
            <span>{d.title}</span>
            <span className="ally-small">{T.fileStatus.staged}</span>
          </li>
        ))}
      </ul>
      {/* TF1 F4: a file held for personal details is approved here, where it was added. */}
      {chatbotId && heldIds && (
        <KnowledgeReview
          botId={chatbotId}
          canEdit={!disabled}
          canManage={!disabled}
          heldIds={heldIds}
        />
      )}
      {creditsOut && <p className="ally-small">{BUILD_COPY.credits.field}</p>}
      {pausedNotes.length > 0 && (
        <p className="ally-small" role="status" data-testid="sources-paused">
          {pausedNotes.join(" ")}
        </p>
      )}
      <form
        className="ally-build__row"
        onSubmit={async event => {
          event.preventDefault();
          if (!address.trim() || busy || off) return;
          if (await run(() => addAddress(address))) setAddress("");
        }}
      >
        <label className="ally-sr-only" htmlFor={`${draftId}-address`}>
          {T.addressLabel}
        </label>
        <input
          id={`${draftId}-address`}
          className="ally-input"
          inputMode="url"
          placeholder={BUILD_COPY.start.addressPlaceholder}
          value={address}
          disabled={off}
          onChange={e => setAddress(e.target.value)}
        />
        <Button type="submit" variant="secondary" disabled={off || busy || !address.trim()}>
          {T.addAddress}
        </Button>
      </form>
      <input
        ref={fileRef}
        type="file"
        multiple
        hidden
        accept={SOURCE_ACCEPT}
        data-testid="sources-upload"
        onChange={event => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          if (!filesOk(files)) {
            setProblem(BUILD_COPY.start.fileLimits);
            return;
          }
          void run(() => addFiles(files));
        }}
      />
      <Button
        variant="ghost"
        disabled={off || busy || !chatbotId}
        onClick={() => fileRef.current?.click()}
      >
        {T.addFiles}
      </Button>
      {problem && (
        <p className="ally-error" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
};
