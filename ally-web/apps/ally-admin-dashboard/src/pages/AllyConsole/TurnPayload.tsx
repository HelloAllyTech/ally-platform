import React, { useState } from "react";

import { Button } from "@ally-ui-mono/ui-shared";
import { useGetAllyGuideTurnPayloadQuery } from "@api";
import {
  isForbiddenError,
  isNotFoundError,
  toPrettyJson,
} from "@components/ally-guide/allyGuideFormat";
import { ErrorPanel, LoadingBlock } from "@components/ally-guide/ConsoleStates";
import { InfoTip } from "@components/ally-guide/InfoTip";
import { en } from "@constants";

interface TurnPayloadProps {
  turnId: string;
  /** From the turn's trace: false means nothing was ever stored, so there is no point asking. */
  hasPayload: boolean | undefined;
}

const PRE_CLASSES =
  "max-h-72 overflow-auto whitespace-pre-wrap break-words bg-background-secondary p-3 font-mono text-xs text-typography-900";

const PayloadSection: React.FC<{ heading: string; children: React.ReactNode }> = ({
  heading,
  children,
}) => (
  <section className="flex flex-col gap-1">
    <h5 className="text-xs tracking-wide text-typography-700">{heading}</h5>
    {children}
  </section>
);

const asText = (value: unknown, empty: string): string =>
  value === null || value === undefined || value === "" ? empty : toPrettyJson(value);

/**
 * "Show payload": the situation report Ally was given, the safety monitor's evidence, tool input and
 * output, and the reply. It holds the learner's words, so it is only mounted for admins with the
 * transcripts grant, and it is fetched only when asked for, never with the turn list.
 *
 * Three different "nothing" answers are kept apart: the turn never had a payload stored (a quiet
 * note, not an error), the admin is not allowed it after all (a permission message), and the fetch
 * failed (a retry).
 */
export const TurnPayload: React.FC<TurnPayloadProps> = ({ turnId, hasPayload }) => {
  const strings = en.allyConsole.inspector.payload;
  const [open, setOpen] = useState(false);
  const { data, isFetching, isError, error, refetch } = useGetAllyGuideTurnPayloadQuery(turnId, {
    skip: !open || hasPayload === false,
  });

  if (hasPayload === false) {
    return (
      <p className="text-sm text-typography-700" data-testid="payload-not-stored">
        {strings.notStored}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid="turn-payload">
      <div className="flex items-center gap-2">
        <Button
          kind="tertiary"
          size="sm"
          aria-expanded={open}
          onClick={() => setOpen(value => !value)}
        >
          {open ? strings.hide : strings.show}
        </Button>
        <InfoTip label={strings.help} ariaLabel="About the payload" />
      </div>

      {open &&
        (isFetching && !data ? (
          <LoadingBlock lines={4} label={strings.loading} />
        ) : isError ? (
          isNotFoundError(error) ? (
            <p className="text-sm text-typography-700" data-testid="payload-not-stored">
              {strings.notStored}
            </p>
          ) : isForbiddenError(error) ? (
            <ErrorPanel what="the payload" error={error} />
          ) : (
            <ErrorPanel what="the payload" error={error} onRetry={() => void refetch()} />
          )
        ) : data ? (
          <div className="flex flex-col gap-4" data-testid="payload-body">
            <PayloadSection heading={strings.situationReport}>
              <pre className={PRE_CLASSES} data-testid="payload-situation">
                {asText(data.situationReport, strings.empty)}
              </pre>
            </PayloadSection>
            <PayloadSection heading={strings.sentinelEvidence}>
              <pre className={PRE_CLASSES} data-testid="payload-evidence">
                {asText(data.sentinelEvidence, strings.empty)}
              </pre>
            </PayloadSection>
            <PayloadSection heading={strings.toolCalls}>
              {Array.isArray(data.toolCalls) && data.toolCalls.length > 0 ? (
                <ul className="flex flex-col gap-2">
                  {data.toolCalls.map((call, index) => {
                    const name =
                      call && typeof call === "object" && "name" in call
                        ? String((call as { name: unknown }).name)
                        : `Tool call ${index + 1}`;
                    return (
                      <li key={`${name}-${index}`} data-testid="payload-tool-call">
                        <p className="mb-1 font-mono text-xs text-typography-900">{name}</p>
                        <pre className={PRE_CLASSES}>{toPrettyJson(call)}</pre>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-sm text-typography-700">{strings.toolCallsNone}</p>
              )}
            </PayloadSection>
            <PayloadSection heading={strings.reply}>
              <pre className={PRE_CLASSES} data-testid="payload-reply">
                {asText(data.reply, strings.replyNone)}
              </pre>
            </PayloadSection>
          </div>
        ) : null)}
    </div>
  );
};
