import React, { useMemo, useState } from "react";

import { useSearchParams } from "react-router-dom";

import { useGetChatbotsQuery, useGetInboxQuery, type InboxChannel, type InboxView } from "@api";
import { Button } from "@components/v2";
import { useUser } from "@hooks";

import { ChatView } from "./ChatView";
import { fill, INBOX } from "./copy";
import {
  askForNotifications,
  canAskForNotifications,
  notify,
  setSound,
  soundOn,
} from "./notifications";
import { useInboxStream } from "./useInboxStream";

import "../../components/v2/v2.css";
import "./inbox.css";

const VIEWS: InboxView[] = ["needs_person", "live", "all"];

const ago = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });

/**
 * The inbox (chunk 11a): every channel's chats, live, Safety and Needs a person first. Pick one to
 * read it, take it over, reply and hand it back. A new Needs a person or Safety chat rings and
 * shows a browser notification (with a mute).
 */
export const Inbox: React.FC = () => {
  const [params, setParams] = useSearchParams();
  const view = (params.get("view") as InboxView) || "all";
  const channel = (params.get("channel") as InboxChannel) || undefined;
  const chatbotId = params.get("assistant") || undefined;
  const selected = params.get("conversation");
  const { data: items = [], isLoading } = useGetInboxQuery({ view, channel, chatbotId });
  const { data: bots } = useGetChatbotsQuery();
  const { user } = useUser();
  const [sound, setSoundState] = useState(soundOn());
  const [askNotify, setAskNotify] = useState(canAskForNotifications());

  const names = useMemo(() => new Map((bots?.chatbots ?? []).map(b => [b.id, b.name])), [bots]);

  const set = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  useInboxStream(event => {
    if (!event.conversationId || !event.chatbotId) return;
    const business = names.get(event.chatbotId) ?? INBOX.nav;
    const open = () => {
      const next = new URLSearchParams(params);
      next.set("conversation", event.conversationId!);
      next.set("bot", event.chatbotId!);
      setParams(next);
    };
    if (event.type === "state" && event.state === "needs_person") {
      notify(fill(INBOX.notifyNeedsPerson, { business }), open);
    }
    if (event.type === "safety") notify(fill(INBOX.notifySafety, { business }), open);
  });

  const current = items.find(item => item.id === selected);
  const currentBot = current?.chatbotId ?? params.get("bot");

  return (
    <div className="ally-v2 ally-inbox" data-testid="inbox">
      <aside className="ally-inbox__list-pane">
        <header className="ally-inbox__head">
          <h1 className="ally-heading">{INBOX.nav}</h1>
          <div className="ally-btn-row">
            <Button
              variant="ghost"
              aria-pressed={sound}
              onClick={() => {
                setSound(!sound);
                setSoundState(!sound);
              }}
            >
              {sound ? INBOX.soundOn : INBOX.soundOff}
            </Button>
            {askNotify && (
              <Button
                variant="ghost"
                onClick={() => void askForNotifications().then(() => setAskNotify(false))}
              >
                {INBOX.turnOnNotifications}
              </Button>
            )}
          </div>
        </header>
        <div className="ally-inbox__filters" role="group" aria-label={INBOX.nav}>
          {VIEWS.map(v => (
            <button
              key={v}
              type="button"
              className="ally-inbox__tab"
              aria-pressed={view === v}
              onClick={() => set("view", v === "all" ? null : v)}
            >
              {INBOX.filters[v]}
            </button>
          ))}
        </div>
        <div className="ally-inbox__selects">
          <label className="sr-only" htmlFor="inbox-channel">
            {INBOX.channels.all}
          </label>
          <select
            id="inbox-channel"
            className="ally-input"
            value={channel ?? ""}
            onChange={event => set("channel", event.target.value || null)}
          >
            <option value="">{INBOX.channels.all}</option>
            <option value="whatsapp">{INBOX.channels.whatsapp}</option>
            <option value="web">{INBOX.channels.web}</option>
          </select>
          <label className="sr-only" htmlFor="inbox-assistant">
            {INBOX.assistant}
          </label>
          <select
            id="inbox-assistant"
            className="ally-input"
            value={chatbotId ?? ""}
            onChange={event => set("assistant", event.target.value || null)}
          >
            <option value="">{INBOX.assistant}</option>
            {(bots?.chatbots ?? []).map(b => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
        {!isLoading && items.length === 0 && (
          <p className="ally-empty">
            {view === "needs_person" ? INBOX.nobodyWaiting : INBOX.empty}
          </p>
        )}
        <ul className="ally-inbox__list" data-testid="inbox-list">
          {items.map(item => (
            <li key={item.id}>
              <button
                type="button"
                className="ally-inbox__item"
                aria-current={item.id === selected ? "true" : undefined}
                onClick={() => {
                  const next = new URLSearchParams(params);
                  next.set("conversation", item.id);
                  next.set("bot", item.chatbotId);
                  setParams(next);
                }}
              >
                <span className="ally-inbox__item-top">
                  <strong>{item.visitor}</strong>
                  <span className="ally-small">{ago(item.lastMessageAt)}</span>
                </span>
                <span className="ally-small ally-inbox__preview">{item.preview}</span>
                <span className="ally-inbox__tags">
                  {item.safety && (
                    <span className="ally-badge ally-inbox__safety">{INBOX.safety}</span>
                  )}
                  {item.state === "needs_person" && (
                    <span className="ally-badge ally-inbox__needs">
                      {INBOX.needsPerson}
                      {item.needsPersonReason ? ` · ${INBOX.reasons[item.needsPersonReason]}` : ""}
                    </span>
                  )}
                  {item.state === "held" && (
                    <span className="ally-badge">
                      {fill(INBOX.replying, { name: item.heldBy?.name ?? "Someone" })}
                    </span>
                  )}
                  <span className="ally-small">
                    {item.assistant} · {INBOX.channels[item.channel === "web" ? "web" : "whatsapp"]}
                  </span>
                  {item.unread > 0 && (
                    <span className="ally-inbox__unread" aria-label={`${item.unread} unread`}>
                      {item.unread}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <main className="ally-inbox__main">
        {selected && currentBot ? (
          <ChatView chatbotId={currentBot} id={selected} me={user?.id ?? null} />
        ) : (
          <p className="ally-empty">{items.length ? "" : INBOX.empty}</p>
        )}
      </main>
    </div>
  );
};
