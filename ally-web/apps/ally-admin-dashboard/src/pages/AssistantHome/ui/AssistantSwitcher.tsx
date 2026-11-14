import React, { useEffect, useId, useRef, useState } from "react";

import { useLocation, useNavigate } from "react-router-dom";

import { useGetChatbotsQuery } from "@api";
import type { Chatbot } from "@types";

import { HOME } from "../copy";
import { Sheet } from "./Sheet";

import type { SectionId } from "../sections";

const t = () => HOME.userLists.switcher;

/** Where an assistant talks: its connectors (WhatsApp…), else "Not shared yet". */
export const channelsOf = (bot: Chatbot): string => {
  const labels = [...new Set((bot.connectors ?? []).map(c => c.typeLabel).filter(Boolean))];
  return labels.length ? labels.join(" · ") : t().notShared;
};

/**
 * Switch assistant (chunk 5b): the owner's other assistants, each with its name and where it
 * talks. Switching keeps the section (Lists stays Lists); the home remounts for the new assistant,
 * so a section's own state (the open list) starts again. On a phone it opens as a bottom sheet.
 */
export const AssistantSwitcher: React.FC<{ bot: Chatbot; section: SectionId; phone: boolean }> = ({
  bot,
  section,
  phone,
}) => {
  const { data } = useGetChatbotsQuery();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLUListElement>(null);
  const id = useId();
  const bots = data?.chatbots ?? [];

  useEffect(() => {
    if (!open || phone) return undefined;
    menu.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    const away = (event: MouseEvent) => {
      if (
        !menu.current?.contains(event.target as Node) &&
        !button.current?.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open, phone]);

  if (bots.length < 2) return null;

  const go = (other: Chatbot) => {
    setOpen(false);
    if (other.id === bot.id) return;
    const path = location.pathname.replace(bot.id, other.id);
    navigate(`${path}?section=${section}`);
  };

  const items = (
    <ul
      ref={menu}
      id={id}
      role="menu"
      aria-label={t().title}
      className="ally-switcher__menu"
      onKeyDown={event => {
        const entries = [...(menu.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
        const at = entries.indexOf(document.activeElement as HTMLElement);
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          const step = event.key === "ArrowDown" ? 1 : -1;
          entries[(at + step + entries.length) % entries.length]?.focus();
        } else if (event.key === "Escape") {
          setOpen(false);
          button.current?.focus();
        }
      }}
    >
      {bots.map(other => (
        <li key={other.id} role="none">
          <button
            type="button"
            role="menuitem"
            className="ally-switcher__item"
            aria-current={other.id === bot.id ? "true" : undefined}
            onClick={() => go(other)}
          >
            <span className="ally-switcher__name">{other.name}</span>
            <span className="ally-switcher__channels">
              {other.id === bot.id ? `${t().current} · ` : ""}
              {channelsOf(other)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="ally-switcher">
      <button
        ref={button}
        type="button"
        className="ally-switcher__button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={t().label}
        aria-describedby={`${id}-tip`}
        onClick={() => setOpen(o => !o)}
      >
        <svg aria-hidden="true" viewBox="0 0 20 20" width="18" height="18">
          <path
            d="M6 8l4-4 4 4M6 12l4 4 4-4"
            stroke="currentColor"
            strokeWidth="1.6"
            fill="none"
            strokeLinecap="round"
          />
        </svg>
      </button>
      <span id={`${id}-tip`} role="tooltip" className="ally-switcher__tip">
        {t().label}
      </span>
      {open &&
        (phone ? (
          <Sheet label={t().title} side="bottom" onClose={() => setOpen(false)}>
            <div className="ally-switcher__sheet">
              <h2 className="ally-heading">{t().title}</h2>
              {items}
            </div>
          </Sheet>
        ) : (
          <div className="ally-switcher__pop">{items}</div>
        ))}
    </div>
  );
};
