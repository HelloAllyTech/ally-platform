import { ErrorText, Footer, PrimaryButton, ScreenHeading } from "../components/parts";

import type { BotPageCopy } from "../copy";
import type { PublicBotPage } from "../types";

/** The first screen: who this is, what it isn't, and Start. */
export function Cover({
  page,
  copy,
  onStart,
  busy = false,
  error,
  turnstile,
}: {
  page: PublicBotPage;
  copy: BotPageCopy;
  onStart(): void;
  busy?: boolean;
  error?: string | null;
  /** Where the Turnstile widget mounts on a public page. */
  turnstile?: React.ReactNode;
}) {
  const { branding } = page;
  const note =
    page.access === "invite"
      ? copy.cover.privateNote
      : page.access === "organisation"
        ? copy.cover.organisationNote
        : null;
  return (
    <div className="flex min-h-full flex-col">
      <div className="h-2 bg-[var(--bp-accent)]" />
      <main className="flex flex-1 flex-col items-center justify-center px-6 py-10 text-center">
        {branding.logoUrl && (
          <img
            src={branding.logoUrl}
            alt=""
            className="mb-6 h-16 w-auto max-w-[200px] object-contain"
          />
        )}
        <ScreenHeading className="text-2xl">{branding.title}</ScreenHeading>
        {branding.subtitle && <p className="mt-2 max-w-sm text-stone-600">{branding.subtitle}</p>}
        {note && <p className="mt-4 max-w-sm text-sm text-stone-500">{note}</p>}
        {turnstile}
        <PrimaryButton className="mt-8 w-full max-w-xs" onClick={onStart} disabled={busy}>
          {busy ? copy.loading : copy.start}
        </PrimaryButton>
        <ErrorText>{error}</ErrorText>
        {branding.disclaimer && (
          <p className="mt-8 max-w-sm text-xs leading-relaxed text-stone-500">
            {branding.disclaimer}
          </p>
        )}
      </main>
      <Footer branding={branding} copy={copy} />
    </div>
  );
}
