import React, { useId, useState } from "react";

import { Link, useParams } from "react-router-dom";

import { Button } from "@components/button";
import { ButtonVariant } from "@components/types";
import { ROUTES } from "@constants";

import { AssistantHome } from "../AssistantHome";
import { STAFF_SUPPORT_COPY } from "./copy";
import { ReadOnlyFrame } from "./ReadOnlyFrame";
import { useSearchStaffChatbotsQuery } from "./staffAccessApi";
import { fill } from "../AssistantHome/copy";

import "../WhatsAppBot/list-page.css";

const c = STAFF_SUPPORT_COPY.page;

/** Where the staff support page lives (stage 8). Gated in RouteLayout by `system:access`. */
export const CHATBOT_SUPPORT_ROUTE = "/admin/chatbot-support";
export const chatbotSupportPath = (botId: string) => `${CHATBOT_SUPPORT_ROUTE}/${botId}`;

/**
 * Assistants stage 8, staff only: search every chatbot by name or owner, and open one read-only.
 * The search is logged; so is every read the opened chatbot makes (server side, fail closed).
 */
export const ChatbotSupport: React.FC = () => {
  const { botId } = useParams();
  if (botId) {
    return (
      <div data-testid="chatbot-support-view">
        <p style={{ margin: "12px 16px 0" }}>
          <Link to={`${ROUTES.ASSISTANTS_ADMIN}/support`}>{c.back}</Link>
        </p>
        <ReadOnlyFrame>
          <AssistantHome readOnly />
        </ReadOnlyFrame>
      </div>
    );
  }
  return <ChatbotSupportSearch />;
};

export const ChatbotSupportSearch: React.FC<{ embedded?: boolean }> = ({ embedded = false }) => {
  const inputId = useId();
  const [text, setText] = useState("");
  const [query, setQuery] = useState<string | null>(null);
  const { data, isFetching, isError } = useSearchStaffChatbotsQuery(query ?? "", {
    skip: query === null,
  });
  return (
    <div className={embedded ? "ally-v2" : "ally-v2 ally-list-page"} data-testid="chatbot-support">
      {!embedded && (
        <header className="ally-list-page__head">
          <div className="ally-list-page__title">
            <h1 className="ally-display">{c.title}</h1>
            <p className="ally-small">{c.subtitle}</p>
          </div>
        </header>
      )}
      <form
        className="ally-add-row"
        role="search"
        onSubmit={event => {
          event.preventDefault();
          setQuery(text.trim());
        }}
      >
        <label htmlFor={inputId} className="ally-sr-only">
          {c.searchLabel}
        </label>
        <input
          id={inputId}
          className="ally-input"
          type="search"
          value={text}
          maxLength={100}
          placeholder={c.searchLabel}
          onChange={event => setText(event.target.value)}
        />
        <Button variant={ButtonVariant.TERTIARY} type="submit" disabled={isFetching}>
          {c.searchButton}
        </Button>
      </form>
      <div className="ally-list-page__body" aria-live="polite">
        {isFetching && <p className="ally-small">{c.loading}</p>}
        {!isFetching && isError && (
          <p className="ally-error" role="alert">
            {c.failed}
          </p>
        )}
        {!isFetching && !isError && data && data.length === 0 && (
          <p className="ally-small">{c.empty}</p>
        )}
        {!isFetching && !isError && data && data.length > 0 && (
          <ul className="ally-list" aria-label={c.title} data-testid="chatbot-support-results">
            {data.map(hit => (
              <li key={hit.id} className="ally-list__row">
                <div className="ally-list__main">
                  <span className="ally-list__title">
                    {hit.name}
                    {hit.archived && <span className="ally-small"> · {c.archived}</span>}
                  </span>
                  <span className="ally-small">
                    {hit.owners.length
                      ? fill(c.owners, {
                          names: hit.owners.map(o => `${o.name} (${o.email})`).join(", "),
                        })
                      : c.noOwner}
                    {hit.conversationsAllowed && ` · ${c.conversationsAllowed}`}
                  </span>
                </div>
                <Link to={chatbotSupportPath(hit.id)} aria-label={`${c.open}: ${hit.name}`}>
                  {c.open}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
