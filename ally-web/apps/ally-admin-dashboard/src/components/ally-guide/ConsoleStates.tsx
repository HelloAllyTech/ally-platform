import React from "react";

import { Button, InlineNotification, SkeletonText } from "@ally-ui-mono/ui-shared";
import { en } from "@constants";

import { isForbiddenError } from "./allyGuideFormat";

interface ErrorPanelProps {
  /** What failed to load, as a noun phrase: "the overview", "releases". */
  what: string;
  error?: unknown;
  onRetry?: () => void;
  /** Overrides the forbidden message, for places that explain access differently. */
  forbiddenMessage?: string;
}

/**
 * A failed load, told apart from an empty list and from a missing permission.
 *
 * "You may not see this" and "we could not fetch it" send the reader to different people, and
 * both must look different from "there is nothing here" — otherwise a 403 reads as an empty
 * conversation list and a 500 reads as a quiet week. The forbidden state offers no retry: asking
 * again does not grant access.
 */
export const ErrorPanel: React.FC<ErrorPanelProps> = ({
  what,
  error,
  onRetry,
  forbiddenMessage,
}) => {
  const strings = en.allyConsole.states;
  if (isForbiddenError(error)) {
    return (
      <div className="py-6" data-testid="ally-forbidden">
        <InlineNotification
          kind="warning"
          lowContrast
          hideCloseButton
          title={strings.forbiddenTitle}
          subtitle={forbiddenMessage ?? strings.forbiddenMessage}
        />
      </div>
    );
  }
  return (
    <div className="flex flex-col items-start gap-3 py-6" data-testid="ally-load-failed">
      <InlineNotification
        kind="error"
        lowContrast
        hideCloseButton
        title={strings.failedTitle(what)}
        subtitle={strings.failedMessage}
      />
      {onRetry && (
        <Button kind="tertiary" size="sm" onClick={onRetry}>
          {strings.retry}
        </Button>
      )}
    </div>
  );
};

/** Skeleton lines for a section that is still loading. */
export const LoadingBlock: React.FC<{ lines?: number; label?: string }> = ({
  lines = 3,
  label = en.allyConsole.states.loading,
}) => (
  <div className="py-4" role="status" aria-live="polite" data-testid="ally-loading">
    <span className="sr-only">{label}</span>
    <SkeletonText paragraph lineCount={lines} />
  </div>
);

interface EmptyPanelProps {
  title: string;
  message?: string;
}

/** A section with genuinely nothing in it. Quiet: no illustration, no call to action it cannot honour. */
export const EmptyPanel: React.FC<EmptyPanelProps> = ({ title, message }) => (
  <div className="py-10 text-center" data-testid="ally-empty">
    <h3 className="text-lg font-normal text-typography-900">{title}</h3>
    {message && <p className="mx-auto mt-1 max-w-xl text-sm text-typography-700">{message}</p>}
  </div>
);

/** The "you can look but not change" note that sits above any editable surface for a read-only admin. */
export const ViewOnlyNote: React.FC<{ message?: string }> = ({ message }) => (
  <InlineNotification
    kind="info"
    lowContrast
    hideCloseButton
    title={message ?? en.allyConsole.viewOnly}
    className="mb-4"
  />
);
