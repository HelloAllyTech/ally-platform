import { createContext, useContext, useEffect, useRef } from "react";

// By path: the bot page imports only self-contained modules (see eslint.config.mjs).
import { Orb } from "../../components/v2/core/Orb";
import { initials } from "../theme";

import type { BotPageCopy } from "../copy";
import type { BotPageBranding, PublicCitation } from "../types";

/**
 * Whether a screen's heading takes focus when it appears. Off in the dashboard's live preview, so
 * the preview never pulls focus away from the form the owner is typing in.
 */
export const FocusHeadings = createContext(true);

/** A screen's heading, focused when the screen appears so screen readers announce it. */
export function ScreenHeading({
  children,
  className = "",
  id,
}: {
  children: string;
  className?: string;
  id?: string;
}) {
  const ref = useRef<HTMLHeadingElement>(null);
  const focus = useContext(FocusHeadings);
  useEffect(() => {
    if (focus) ref.current?.focus();
  }, [focus]);
  return (
    <h1 ref={ref} id={id} tabIndex={-1} className={`ally-display bp-heading ${className}`}>
      {children}
    </h1>
  );
}

/** The page's logo, or (without one) the assistant's initials in the brand colour. */
export function LogoMark({ branding }: { branding: BotPageBranding }) {
  const logo = branding.look?.logo;
  if (logo || branding.logoUrl) {
    return (
      <img
        src={logo?.src ?? branding.logoUrl ?? ""}
        srcSet={logo?.srcset || undefined}
        sizes="72px"
        alt=""
      />
    );
  }
  return (
    <span className="bp-initials" aria-hidden="true">
      {initials(branding.assistantName)}
    </span>
  );
}

/** The chat's avatar: the owner's picture, else the orb in the brand colour. */
export function Avatar({ branding, size = 40 }: { branding: BotPageBranding; size?: number }) {
  if (branding.avatarUrl) {
    return (
      <img
        src={branding.avatarUrl}
        alt=""
        width={size}
        height={size}
        className="bp-header__logo"
        style={{ borderRadius: 999 }}
      />
    );
  }
  return <Orb size={size} />;
}

/**
 * The bar at the top of every screen after the cover: the orb (or the owner's picture), the
 * page's name and a status line.
 */
export function PageHeader({
  branding,
  subtitle,
  children,
}: {
  branding: BotPageBranding;
  subtitle?: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="bp-header">
      <Avatar branding={branding} />
      <div className="bp-header__text">
        <p className="bp-header__name">{branding.assistantName || branding.title}</p>
        {subtitle && (
          <p className="bp-header__status" aria-live="polite">
            {subtitle}
          </p>
        )}
      </div>
      {children}
    </header>
  );
}

export function TypingDots({ label }: { label: string }) {
  return (
    <span className="bp-dots" role="img" aria-label={label}>
      <span />
      <span />
      <span />
    </span>
  );
}

const DocIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    aria-hidden="true"
  >
    <path d="M14 3H6v18h12V7z" />
    <path d="M14 3v4h4" />
  </svg>
);

/** Where an answer came from, once, as chips under it. */
export function Sources({ citations, copy }: { citations: PublicCitation[]; copy: BotPageCopy }) {
  if (!citations.length) return null;
  return (
    <div>
      <p className="ally-sr-only">{copy.chat.sources}</p>
      <ul className="bp-sources">
        {citations.map(c => (
          <li key={c.title}>
            {c.url ? (
              <a className="bp-source" href={c.url} target="_blank" rel="noopener noreferrer">
                <DocIcon />
                {c.title}
              </a>
            ) : (
              <span className="bp-source">
                <DocIcon />
                {c.title}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PrimaryButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { className = "", ...rest } = props;
  return (
    <button
      type="button"
      {...rest}
      className={`ally-btn ally-btn--primary ally-press ${className}`}
    />
  );
}

export function TextButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { className = "", ...rest } = props;
  return <button type="button" {...rest} className={`ally-btn ally-btn--ghost ${className}`} />;
}

/** An error the visitor can read, announced as it appears. */
export function ErrorText({ children }: { children?: string | null }) {
  if (!children) return null;
  return (
    <p role="alert" className="bp-error">
      {children}
    </p>
  );
}

export function Footer({ branding, copy }: { branding: BotPageBranding; copy: BotPageCopy }) {
  return (
    <footer className="bp-footer">
      {branding.footerLink && (
        <a href={branding.footerLink.url} target="_blank" rel="noopener noreferrer">
          {branding.footerLink.label}
        </a>
      )}
      <span>{copy.poweredBy}</span>
    </footer>
  );
}
