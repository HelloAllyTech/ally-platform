import { useEffect, useRef } from "react";

const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

interface TurnstileApi {
  render(
    el: HTMLElement,
    options: { sitekey: string; callback(token: string): void; "expired-callback"(): void },
  ): string;
  remove(id: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let loading: Promise<void> | null = null;
const loadScript = () =>
  (loading ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Turnstile did not load"));
    document.head.appendChild(script);
  }));

/** Cloudflare's bot check, on public pages when ally-be is configured with a site key. */
export function Turnstile({
  siteKey,
  onToken,
}: {
  siteKey: string;
  onToken(token: string | null): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let widget: string | undefined;
    let cancelled = false;
    loadScript()
      .then(() => {
        if (cancelled || !ref.current || !window.turnstile) return;
        widget = window.turnstile.render(ref.current, {
          sitekey: siteKey,
          callback: token => onToken(token),
          "expired-callback": () => onToken(null),
        });
      })
      .catch(() => onToken(null));
    return () => {
      cancelled = true;
      if (widget) window.turnstile?.remove(widget);
    };
  }, [siteKey, onToken]);
  return <div ref={ref} className="mt-6 min-h-[65px]" />;
}
