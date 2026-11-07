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
    <main className="flex min-h-full flex-col items-center justify-center px-6 text-center">
      <ScreenHeading>{message}</ScreenHeading>
      {onAction && (
        <PrimaryButton className="mt-6" onClick={onAction}>
          {actionLabel ?? copy.errors.tryAgain}
        </PrimaryButton>
      )}
    </main>
  );
}
