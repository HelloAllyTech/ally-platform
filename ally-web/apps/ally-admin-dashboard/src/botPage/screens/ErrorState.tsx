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
      {/* TF1 F11: an off message's first line is the heading; the crisis lines follow it. */}
      <ScreenHeading className="bp-error-heading">{message.split("\n")[0]}</ScreenHeading>
      {message.includes("\n") && (
        <p className="bp-body" style={{ whiteSpace: "pre-line" }} data-testid="bp-error-more">
          {message.split("\n").slice(1).join("\n").trim()}
        </p>
      )}
      {onAction && (
        <PrimaryButton onClick={onAction}>{actionLabel ?? copy.errors.tryAgain}</PrimaryButton>
      )}
    </main>
  );
}
