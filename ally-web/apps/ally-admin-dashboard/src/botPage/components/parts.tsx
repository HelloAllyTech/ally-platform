import { createContext, useContext, useEffect, useRef } from "react";

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
    <h1
      ref={ref}
      id={id}
      tabIndex={-1}
      className={`text-xl font-semibold text-stone-900 outline-none ${className}`}
    >
      {children}
    </h1>
  );
}

export function Avatar({ branding, size = 32 }: { branding: BotPageBranding; size?: number }) {
  const style = { width: size, height: size };
  if (branding.avatarUrl) {
    return (
      <img
        src={branding.avatarUrl}
        alt=""
        style={style}
        className="shrink-0 rounded-full object-cover"
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      style={style}
      className="flex shrink-0 items-center justify-center rounded-full bg-[var(--bp-accent)] text-xs font-semibold text-[var(--bp-on-accent)]"
    >
      {initials(branding.assistantName)}
    </span>
  );
}

/** The bar at the top of every screen after the cover: logo (or avatar) and the page's title. */
export function PageHeader({
  branding,
  children,
}: {
  branding: BotPageBranding;
  children?: React.ReactNode;
}) {
  return (
    <header className="flex items-center gap-3 border-b border-stone-200 bg-white px-4 py-3">
      {branding.logoUrl ? (
        <img src={branding.logoUrl} alt="" className="h-8 w-auto max-w-[96px] object-contain" />
      ) : (
        <Avatar branding={branding} />
      )}
      <p className="min-w-0 flex-1 truncate font-semibold text-stone-900">{branding.title}</p>
      {children}
    </header>
  );
}

export function TypingDots({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1" aria-label={label}>
      {[0, 1, 2].map(i => (
        <span
          key={i}
          className="h-1.5 w-1.5 animate-bounce rounded-full bg-stone-400 motion-reduce:animate-none"
          style={{ animationDelay: `${i * 150}ms` }}
        />
      ))}
    </span>
  );
}

export function Sources({ citations, copy }: { citations: PublicCitation[]; copy: BotPageCopy }) {
  if (!citations.length) return null;
  return (
    <div className="mt-2 border-t border-stone-200 pt-2 text-xs text-stone-600">
      <p className="font-semibold">{copy.chat.sources}</p>
      <ul className="mt-1 space-y-0.5">
        {citations.map(c => (
          <li key={c.title}>
            {c.url ? (
              <a
                href={c.url}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2"
              >
                {c.title}
              </a>
            ) : (
              c.title
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
      className={`min-h-[44px] rounded-lg bg-[var(--bp-accent)] px-5 font-semibold text-[var(--bp-on-accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--bp-accent)] focus-visible:ring-offset-2 disabled:opacity-50 ${className}`}
    />
  );
}

export function TextButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { className = "", ...rest } = props;
  return (
    <button
      type="button"
      {...rest}
      className={`min-h-[44px] px-2 text-sm font-semibold text-stone-700 underline underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--bp-accent)] disabled:opacity-50 ${className}`}
    />
  );
}

/** An error the visitor can read, announced as it appears. */
export function ErrorText({ children }: { children?: string | null }) {
  if (!children) return null;
  return (
    <p role="alert" className="mt-2 text-sm text-red-700">
      {children}
    </p>
  );
}

export function Footer({ branding, copy }: { branding: BotPageBranding; copy: BotPageCopy }) {
  return (
    <footer className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-4 py-3 text-xs text-stone-500">
      {branding.footerLink && (
        <a
          href={branding.footerLink.url}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2"
        >
          {branding.footerLink.label}
        </a>
      )}
      <span>{copy.poweredBy}</span>
    </footer>
  );
}
