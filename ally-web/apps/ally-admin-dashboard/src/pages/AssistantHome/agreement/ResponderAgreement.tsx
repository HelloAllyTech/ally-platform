import React, { useState } from "react";

import { useAcceptResponderAgreementMutation, useGetResponderAgreementQuery } from "@api";
import { Button } from "@components/button";
import { ButtonVariant } from "@components/types";

import { fill } from "../copy";
import { PEOPLE } from "../copy/people";
import { LoadFailed } from "../sections/AccessLists";
import { errorInfo } from "../teamErrors";
import { ListError, ListSkeleton } from "../ui/List";
import { Sheet } from "../ui/Sheet";

const t = PEOPLE.agreement;

/** The agreement text and the one button that accepts the version on screen. */
export const ResponderAgreementPanel: React.FC<{
  onAccepted?: () => void;
  onClose?: () => void;
}> = ({ onAccepted, onClose }) => {
  const { data, isLoading, isError, refetch } = useGetResponderAgreementQuery();
  const [accept, { isLoading: saving }] = useAcceptResponderAgreementMutation();
  const [error, setError] = useState<string | null>(null);

  if (isLoading) return <ListSkeleton />;
  if (isError || !data) return <LoadFailed onRetry={() => void refetch()} />;

  const agree = async () => {
    setError(null);
    try {
      await accept({ version: data.currentVersion }).unwrap();
      onAccepted?.();
    } catch (failure) {
      if (errorInfo(failure).code === "stale_version") {
        setError(t.stale);
        void refetch();
      } else {
        setError(t.failed);
      }
    }
  };

  return (
    <div className="ally-home__stack" data-testid="responder-agreement">
      <h2 className="ally-heading">{t.title}</h2>
      <p className="ally-body">{t.intro}</p>
      <pre className="ally-body" style={{ whiteSpace: "pre-wrap", font: "inherit" }}>
        {data.text || t.fallbackText}
      </pre>
      <p className="ally-small">{fill(t.version, { version: data.currentVersion })}</p>
      <ListError error={error} />
      <div className="ally-btn-row">
        <Button type="button" disabled={saving} onClick={() => void agree()}>
          {saving ? t.accepting : t.accept}
        </Button>
        {onClose && (
          <Button variant={ButtonVariant.TEXT} type="button" onClick={onClose}>
            {t.close}
          </Button>
        )}
      </div>
    </div>
  );
};

/** The agreement as a dialog over the page, opened when a reply or take-over is refused for it. */
export const ResponderAgreementDialog: React.FC<{
  onClose: () => void;
  onAccepted?: () => void;
}> = ({ onClose, onAccepted }) => (
  <Sheet label={t.title} onClose={onClose} side="center" testId="agreement-dialog">
    <ResponderAgreementPanel
      onClose={onClose}
      onAccepted={() => {
        onAccepted?.();
        onClose();
      }}
    />
  </Sheet>
);

/**
 * Shown INSTEAD of the conversations for someone who holds only Responder, until they accept the
 * current agreement. (An owner or editor reads freely; theirs is the dialog, on a take-over.)
 * If the status can't be read, the conversations show and the server still decides.
 */
export const ResponderAgreementGate: React.FC<{
  required: boolean;
  children: React.ReactNode;
}> = ({ required, children }) => {
  const { data, isLoading } = useGetResponderAgreementQuery(undefined, { skip: !required });
  if (!required) return <>{children}</>;
  if (isLoading) return <div aria-busy="true" />;
  if (data && data.enforced && !data.accepted) return <ResponderAgreementPanel />;
  return <>{children}</>;
};
