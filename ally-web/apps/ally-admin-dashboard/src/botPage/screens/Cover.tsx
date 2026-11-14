import { ErrorText, Footer, LogoMark, PrimaryButton, ScreenHeading } from "../components/parts";
import { fill } from "../copy";

import type { BotPageCopy } from "../copy";
import type { PublicBotPage } from "../types";

const Arrow = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    aria-hidden="true"
  >
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

/**
 * The first screen (screenshot 02-bot-page-01): the cover image (or the orb in the brand colour),
 * the logo tile, the heading in the page's style, what it isn't, and Start.
 */
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
  const cover = branding.look?.cover;
  const note =
    page.access === "invite"
      ? copy.cover.privateNote
      : page.access === "organisation"
        ? copy.cover.organisationNote
        : null;
  return (
    <div className="bp-screen bp-pad">
      <div className="bp-cover-image ally-rise">
        {cover ? (
          <img
            className="bp-cover-photo"
            src={cover.src}
            srcSet={cover.srcset || undefined}
            sizes="(max-width: 640px) 100vw, 640px"
            width={cover.width}
            height={cover.height}
            alt={cover.alt || fill(copy.cover.coverAlt, { business: branding.title })}
          />
        ) : (
          <span
            className="ally-orb ally-breathe"
            aria-hidden="true"
            style={{ width: 96, height: 96 }}
          />
        )}
        <span className="bp-logo-tile">
          <LogoMark branding={branding} />
        </span>
      </div>
      <div className="bp-stack bp-cover-title bp-grow">
        <ScreenHeading>{branding.title}</ScreenHeading>
        {branding.subtitle && (
          <p className="ally-body bp-muted" style={{ margin: 0 }}>
            {branding.subtitle}
          </p>
        )}
        {note && (
          <p className="bp-small" style={{ margin: 0 }}>
            {note}
          </p>
        )}
        {turnstile}
      </div>
      <div className="bp-stack" style={{ paddingTop: 24 }}>
        <div className="bp-cta">
          <PrimaryButton onClick={onStart} disabled={busy}>
            {busy ? copy.loading : copy.start}
            {!busy && <Arrow />}
          </PrimaryButton>
        </div>
        <ErrorText>{error}</ErrorText>
        {branding.disclaimer && (
          <p className="bp-small bp-center" style={{ margin: 0 }}>
            {branding.disclaimer}
          </p>
        )}
      </div>
      <Footer branding={branding} copy={copy} />
    </div>
  );
}
