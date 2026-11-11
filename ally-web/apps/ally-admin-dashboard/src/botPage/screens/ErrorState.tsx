import { PrimaryButton, ScreenHeading } from "../components/parts";

import type { BotPageCopy } from "../copy";

/** A whole-page problem: the link is off, the visitor's session ended, or the network is down. */
export function ErrorState({
  copy,
  message,
  actionLabel,
  onAction,
}: {
  copy: BotPageCopy;
  message: string;
  actionLabel?: string;
  onAction?(): void;
}) {
  return (
    <main className="bp-screen bp-pad" style={{ justifyContent: "center", gap: 24 }}>
      <span className="ally-orb" aria-hidden="true" style={{ width: 48, height: 48 }} />
      <ScreenHeading className="bp-error-heading">{message}</ScreenHeading>
      {onAction && (
        <PrimaryButton onClick={onAction}>{actionLabel ?? copy.errors.tryAgain}</PrimaryButton>
      )}
    </main>
  );
}
