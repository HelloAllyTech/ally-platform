import React, { useId, useState } from "react";

import { Button } from "@components/button";
import { Input } from "@components/input";
import { ButtonVariant } from "@components/types";

import { STAFF_SUPPORT_COPY } from "../../ChatbotSupport/copy";
import {
  useGetStaffGrantsQuery,
  useGetStaffViewsQuery,
  useGrantStaffAccessMutation,
  useRevokeStaffAccessMutation,
} from "../../ChatbotSupport/staffAccessApi";
import { fill } from "../copy";
import { when } from "../dates";
import { Group } from "../fields";
import { ListRow, ListRows } from "../ui/List";

import type { SectionProps } from "./props";

const c = STAFF_SUPPORT_COPY.owner;

/**
 * Assistants stage 8, owners only: let Ally staff read conversations for a while (default 24 hours,
 * at most 7 days), stop that at once, and see every staff look at this chatbot ("Who looked").
 * Staff can always view the setup read-only; that is listed here too.
 */
export const StaffAccess: React.FC<Pick<SectionProps, "bot" | "canManage">> = ({
  bot,
  canManage,
}) => {
  if (!canManage) return null;
  return <StaffAccessPanel botId={bot.id} />;
};

export const StaffAccessPanel: React.FC<{ botId: string }> = ({ botId }) => {
  const hoursId = useId();
  const reasonId = useId();
  const [hours, setHours] = useState(24);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const grants = useGetStaffGrantsQuery(botId);
  const views = useGetStaffViewsQuery(botId);
  const [grant, { isLoading: granting }] = useGrantStaffAccessMutation();
  const [revoke, { isLoading: revoking }] = useRevokeStaffAccessMutation();
  const live = grants.data?.grants.find(g => g.status === "live") ?? null;

  const allow = async () => {
    setError(null);
    setNote(null);
    try {
      await grant({ id: botId, hours, reason: reason.trim() || undefined }).unwrap();
      setReason("");
      grants.refetch();
    } catch {
      setError(c.failed);
    }
  };
  const stop = async (grantId: string) => {
    setError(null);
    try {
      await revoke({ id: botId, grantId }).unwrap();
      setNote(c.revoked);
      grants.refetch();
    } catch {
      setError(c.failed);
    }
  };

  return (
    <Group title={c.title} hint={c.hint} testId="settings-staff-access">
      <p className="ally-small" role="status" data-testid="staff-access-state">
        {live ? fill(c.liveUntil, { when: when(live.expiresAt) }) : c.noneLive}
      </p>
      {live ? (
        <Button
          variant={ButtonVariant.TERTIARY}
          type="button"
          disabled={revoking}
          onClick={() => void stop(live.id)}
        >
          {c.revoke}
        </Button>
      ) : (
        <div className="ally-add-row">
          <label htmlFor={hoursId}>{c.allowLabel}</label>
          <select
            id={hoursId}
            className="ally-input ally-input--compact"
            value={hours}
            onChange={event => setHours(Number(event.target.value))}
          >
            {c.durations.map(d => (
              <option key={d.hours} value={d.hours}>
                {d.label}
              </option>
            ))}
          </select>
          <label htmlFor={reasonId} className="ally-sr-only">
            {c.reasonLabel}
          </label>
          <Input
            id={reasonId}
            className="!w-full"
            value={reason}
            maxLength={500}
            placeholder={c.reasonLabel}
            onChange={event => setReason(event.target.value)}
          />
          <Button
            variant={ButtonVariant.TERTIARY}
            type="button"
            disabled={granting}
            onClick={() => void allow()}
          >
            {granting ? c.allowing : c.allow}
          </Button>
        </div>
      )}
      {note && (
        <p className="ally-small" role="status">
          {note}
        </p>
      )}
      {error && (
        <p className="ally-error" role="alert">
          {error}
        </p>
      )}
      <h4 className="ally-home__subhead">{c.viewsTitle}</h4>
      {views.isError ? (
        <p className="ally-small">{c.viewsFailed}</p>
      ) : views.data?.views.length ? (
        <ListRows label={c.viewsTitle} testId="staff-views">
          {views.data.views.map(view => (
            <ListRow
              key={view.id}
              title={fill(c.viewRow, {
                who: view.staffName ?? c.someone,
                what: view.what.toLowerCase(),
              })}
              badge={
                view.conversations ? (
                  <span className="ally-small"> · {c.conversationTag}</span>
                ) : undefined
              }
              meta={when(view.at)}
            />
          ))}
        </ListRows>
      ) : views.isLoading ? null : (
        <p className="ally-small">{c.viewsEmpty}</p>
      )}
    </Group>
  );
};
