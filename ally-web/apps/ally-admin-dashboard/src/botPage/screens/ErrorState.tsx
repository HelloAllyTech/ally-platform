import { CrisisInfo } from "./Access";
import { PrimaryButton, ScreenHeading } from "../components/parts";

import type { BotPageCopy } from "../copy";
import type { PublicBotPage } from "../types";

/** A whole-page problem: the link is off, the visitor's session ended, or the network is down. */
export function ErrorState({
  copy,
  message,
  actionLabel,
  onAction,
  crisis,
}: {
  copy: BotPageCopy;
  message: string;
  /** TF1 round 2 (Saathi B-9): the assistant's crisis numbers when known; the general ones otherwise. */
  crisis?: PublicBotPage["crisis"];
  actionLabel?: string;
  onAction?(): void;
}) {
  return (
    <main className="bp-screen bp-pad" style={{ justifyContent: "center", gap: 24 }}>
      <span className="ally-orb" aria-hidden="true" style={{ width: 48, height: 48 }} />
      {/* TF1 F11: an off message's first line is the heading; the crisis lines follow it. */}
      <ScreenHeading className="bp-error-heading">{message.split("\n")[0]}</ScreenHeading>
      {message.includes("\n") && (
        <p
          className="ally-body bp-body"
          style={{ whiteSpace: "pre-line" }}
          data-testid="bp-error-more"
        >
          {message.split("\n").slice(1).join("\n").trim()}
        </p>
      )}
      {onAction && (
        <PrimaryButton onClick={onAction}>{actionLabel ?? copy.errors.tryAgain}</PrimaryButton>
      )}
      {/* TF1 round 2 (Saathi B-9): every screen, a refusal or a bad link too, has a number to
          call. An off message already carries the assistant's own (F11). */}
      {!message.includes("\n") && <CrisisInfo copy={copy} crisis={crisis} invited={false} />}
    </main>
  );
}
