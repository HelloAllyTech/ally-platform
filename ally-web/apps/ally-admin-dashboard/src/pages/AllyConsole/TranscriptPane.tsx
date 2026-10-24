import React from "react";

import { useGetAllyGuideTranscriptQuery } from "@api";
import { ErrorPanel, LoadingBlock } from "@components/ally-guide/ConsoleStates";
import { Pill } from "@components/ally-guide/Pill";
import { en } from "@constants";
import { AllyGuideTranscriptMessage } from "@types";
import { formatTimestamp } from "@utils";

/** The server reads at most this many messages (`GuideAdminService.transcript`). */
export const TRANSCRIPT_CAP = 500;

interface TranscriptPaneProps {
  threadId: string;
  /** The turn currently open on the left; its messages are marked. */
  activeTurnId: string | null;
  /** Opens a turn's details when its message is chosen. */
  onSelectTurn: (turnId: string) => void;
}

const MessageRow: React.FC<{
  message: AllyGuideTranscriptMessage;
  active: boolean;
  onSelectTurn: (turnId: string) => void;
}> = ({ message, active, onSelectTurn }) => {
  const strings = en.allyConsole.inspector.transcript;
  const isLearner = message.role === "learner";
  const flags = Object.entries(message.flags ?? {}).filter(([, on]) => Boolean(on));
  const kindLabel = message.kind && message.kind !== "chat" ? strings.kinds[message.kind] : null;

  const body = (
    <>
      <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-typography-700">
        <span className="font-semibold text-typography-900">
          {isLearner ? strings.learner : strings.ally}
        </span>
        {message.createdAt && <span>{formatTimestamp(message.createdAt)}</span>}
        {kindLabel && <Pill tone="info">{kindLabel}</Pill>}
        {flags.map(([flag]) => (
          <Pill key={flag} tone={flag === "crisis" ? "danger" : "warning"}>
            {strings.flags[flag] ?? flag}
          </Pill>
        ))}
      </div>
      <p className="whitespace-pre-wrap break-words text-sm text-typography-900">{message.text}</p>
    </>
  );

  const frame = `border-l-4 p-3 text-left ${
    active ? "border-primary-500 bg-primary-50" : "border-border-light bg-white"
  } ${isLearner ? "" : "ml-4"}`;

  return (
    <li data-testid="transcript-message" data-role={message.role}>
      {message.turnId ? (
        <button
          type="button"
          className={`block w-full ${frame} hover:bg-background-secondary`}
          aria-label={`${isLearner ? strings.learner : strings.ally}: ${strings.jumpToTurn}`}
          onClick={() => onSelectTurn(message.turnId as string)}
        >
          {body}
        </button>
      ) : (
        <div className={frame}>{body}</div>
      )}
    </li>
  );
};

/**
 * The redacted conversation, beside the turns. Mounted only for admins holding BOTH the per-person
 * transcripts toggle and the review permission; the redaction itself is the server's (contact
 * details and long numbers masked, a message about a real person hidden whole), and this pane says
 * so rather than leaving the reader to wonder why a message is missing.
 */
export const TranscriptPane: React.FC<TranscriptPaneProps> = ({
  threadId,
  activeTurnId,
  onSelectTurn,
}) => {
  const strings = en.allyConsole.inspector.transcript;
  const { data, isLoading, isError, error, refetch } = useGetAllyGuideTranscriptQuery(threadId);

  return (
    <section aria-labelledby="ally-transcript-heading" data-testid="transcript-pane">
      <h3 id="ally-transcript-heading" className="text-xl font-normal text-typography-900">
        {strings.title}
      </h3>
      <p className="mb-3 mt-1 text-xs text-typography-700">{strings.redactionNote}</p>
      {isLoading ? (
        <LoadingBlock lines={6} label={strings.loading} />
      ) : isError || !data ? (
        <ErrorPanel what="the transcript" error={error} onRetry={() => void refetch()} />
      ) : data.length === 0 ? (
        <p className="text-sm text-typography-700" data-testid="transcript-empty">
          {strings.empty}
        </p>
      ) : (
        <>
          <ol className="flex flex-col gap-2">
            {data.map(message => (
              <MessageRow
                key={message.id}
                message={message}
                active={message.turnId !== null && message.turnId === activeTurnId}
                onSelectTurn={onSelectTurn}
              />
            ))}
          </ol>
          {data.length >= TRANSCRIPT_CAP && (
            <p className="mt-3 text-xs text-typography-700">{strings.capped(TRANSCRIPT_CAP)}</p>
          )}
        </>
      )}
    </section>
  );
};
