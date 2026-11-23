import React, { useCallback, useEffect, useState } from "react";

import { Button } from "@components/button";
import { ButtonVariant } from "@components/types";

import { STAFF_CONVERSATIONS_COPY } from "./copy";
import { useGetStaffConversationAccessQuery } from "./staffAccessApi";
import { fill } from "../AssistantHome/copy";
import { Inbox } from "../Inbox";

const c = STAFF_CONVERSATIONS_COPY;

/** setTimeout's longest wait (about 24.8 days); a grant is at most 7 days. */
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });

/**
 * Ally staff's Conversations section (stage 8): the chatbot's inbox, read-only, only while an
 * owner's grant is live. It asks `GET /v1/staff/chatbots/:id/conversation-access` first, so no
 * grant shows a plain panel instead of a 403. With a grant: a persistent "read-only, logged" banner
 * with the expiry, and the inbox (which reads `useReadOnly` and drops every action). When the grant
 * runs out, at its expiry or on the next 403, it asks again and shows the no-grant panel.
 * The server enforces all of this; the UI only shows the right state.
 */
export const StaffConversations: React.FC<{ chatbotId: string }> = ({ chatbotId }) => {
  const { data, isLoading, isError, refetch, fulfilledTimeStamp } =
    useGetStaffConversationAccessQuery(chatbotId);
  // A 403 from the inbox, or the expiry passing: the grant is gone at once, until an answer that
  // arrived after it says otherwise.
  const [lostAt, setLostAt] = useState<number | null>(null);
  const lost = lostAt !== null && (fulfilledTimeStamp ?? 0) <= lostAt;

  const recheck = useCallback(() => {
    setLostAt(Date.now());
    void refetch();
  }, [refetch]);

  // Ask again the moment the grant expires, without waiting for a 403.
  const expiresAt = data?.granted ? data.expiresAt : undefined;
  useEffect(() => {
    if (!expiresAt) return undefined;
    const wait = Math.min(Math.max(Date.parse(expiresAt) - Date.now() + 1000, 0), MAX_TIMEOUT_MS);
    const timer = setTimeout(recheck, wait);
    return () => clearTimeout(timer);
  }, [expiresAt, recheck]);

  if (isLoading) {
    return (
      <p className="ally-small" aria-busy="true" data-testid="staff-conversations-checking">
        {c.checking}
      </p>
    );
  }
  if (isError) {
    return (
      <div className="ally-card" role="alert" style={{ padding: "12px 16px" }}>
        <p className="ally-error">{c.checkFailed}</p>
        <Button variant={ButtonVariant.TERTIARY} type="button" onClick={() => void refetch()}>
          {c.retry}
        </Button>
      </div>
    );
  }
  if (!data?.granted || lost) {
    return (
      <div
        className="ally-card"
        role="status"
        data-testid="staff-conversations-no-grant"
        style={{ padding: "12px 16px" }}
      >
        <p className="ally-body" style={{ margin: 0 }}>
          {c.noGrant}
        </p>
      </div>
    );
  }
  return (
    <div data-testid="staff-conversations">
      <div
        className="ally-card"
        role="status"
        data-testid="staff-conversations-banner"
        style={{ padding: "12px 16px", marginBottom: 12 }}
      >
        <strong>{c.banner}</strong>
        {data.expiresAt && (
          <p className="ally-small" style={{ margin: "4px 0 0" }}>
            {fill(c.until, { when: when(data.expiresAt) })}
          </p>
        )}
      </div>
      {/* The app bar, the headers, this title and the banner sit above the panel. */}
      <div style={{ ["--ally-inbox-top" as string]: "330px" }}>
        <Inbox chatbotId={chatbotId} onForbidden={recheck} />
      </div>
    </div>
  );
};
