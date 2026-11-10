import React, { useEffect, useId, useRef, useState } from "react";

export interface MenuItem {
  label: string;
  /** A link opens in place (or a new tab with `external`); otherwise `onSelect` runs. */
  href?: string;
  external?: boolean;
  onSelect?: () => void;
  /** Shown only below 960 px (where the header has no room for it). */
  phoneOnly?: boolean;
}

/**
 * The header's `···` menu (chunk 20d-2): Ally staff's tools (How it answers, Classic view), and on
 * a phone, Open page. A real menu button: Enter or Space opens it, arrows move, Esc closes and
 * focus goes back to the button.
 */
export const MoreMenu: React.FC<{ label: string; items: MenuItem[] }> = ({ label, items }) => {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLUListElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return undefined;
    menu.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    const away = (event: MouseEvent) => {
      if (!menu.current?.contains(event.target as Node) && event.target !== button.current) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  const onKey = (event: React.KeyboardEvent) => {
    const entries = [
      ...(menu.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? []),
    ].filter(entry => entry.offsetParent !== null);
    const at = entries.indexOf(document.activeElement as HTMLElement);
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      entries[(at + step + entries.length) % entries.length]?.focus();
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  };

  if (!items.length) return null;
  const onlyOnPhones = items.every(item => item.phoneOnly);
  return (
    <div className={`ally-more${onlyOnPhones ? " ally-more--phone" : ""}`}>
      <button
        ref={button}
        type="button"
        className="ally-btn ally-btn--secondary ally-more__button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        aria-label={label}
        title={label}
        onClick={() => setOpen(o => !o)}
      >
        <svg aria-hidden="true" viewBox="0 0 20 20" width="18" height="18">
          <circle cx="4" cy="10" r="1.6" fill="currentColor" />
          <circle cx="10" cy="10" r="1.6" fill="currentColor" />
          <circle cx="16" cy="10" r="1.6" fill="currentColor" />
        </svg>
      </button>
      {open && (
        <ul
          ref={menu}
          id={id}
          role="menu"
          aria-label={label}
          className="ally-more__menu"
          onKeyDown={onKey}
        >
          {items.map(item => (
            <li
              key={item.label}
              role="none"
              className={item.phoneOnly ? "ally-more__phone" : undefined}
            >
              {item.href ? (
                <a
                  role="menuitem"
                  tabIndex={-1}
                  href={item.href}
                  {...(item.external ? { target: "_blank", rel: "noreferrer" } : {})}
                  onClick={() => setOpen(false)}
                >
                  {item.label}
                </a>
              ) : (
                <button
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  onClick={() => {
                    setOpen(false);
                    item.onSelect?.();
                  }}
                >
                  {item.label}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
