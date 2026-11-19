import React, { useState } from "react";

import { useAssignSeatMutation, useGetAssistantSeatsQuery } from "@api";
import type { AssistantSeatsView, PlanSeat } from "@api";
import { Button } from "@components/button";
import { ButtonVariant } from "@components/types";

import { LoadFailed } from "./AccessLists";
import { PLAN } from "../../Plan/copy";
import { Meter, SeatList } from "../../Plan/ui";
import { ListError, ListRow, ListRows, ListSkeleton } from "../ui/List";

/** A seat nobody holds that can still be given (not lapsed or cancelled). */
const freeSeat = (seats: PlanSeat[]): PlanSeat | undefined =>
  seats.find(
    seat => !seat.assigneeEmail && seat.status !== "lapsed" && seat.status !== "cancelled",
  );

const ROLE_WORD: Record<string, string> = {
  owner: "Owner",
  editor: "Editor",
  viewer: "Viewer",
  invited: "Invited",
};

/** The seats block, drawn from the view (the tests draw it directly). */
export const SeatsBlock: React.FC<{
  view: AssistantSeatsView;
  canManage: boolean;
  busy: boolean;
  error: string | null;
  onAssign: (seatId: string, email: string | null) => void;
}> = ({ view, canManage, busy, error, onAssign }) => {
  if (!view.seatsRequired) {
    return (
      <p className="ally-small" data-testid="seats-not-required">
        {PLAN.seats.notRequired}
      </p>
    );
  }
  const free = freeSeat(view.seats);
  const withoutSeat = view.people.filter(person => !person.hasSeat);
  return (
    <div className="ally-home__list-block" data-testid="share-seats">
      <p className="ally-body" style={{ margin: 0 }} data-testid="seat-summary">
        {view.seatSummary}
        {view.unassigned > 0 ? ` · ${PLAN.seats.unassigned(view.unassigned)}` : ""}
      </p>
      <SeatList
        seats={view.seats}
        assigning={canManage ? { people: view.people, busy, onAssign } : undefined}
      />
      {withoutSeat.length > 0 && (
        <ListRows label={PLAN.seats.noSeatBadge}>
          {withoutSeat.map(person => (
            <ListRow
              key={person.email}
              title={person.email}
              badge={<span className="ally-badge ally-badge--muted">{PLAN.seats.noSeatBadge}</span>}
              meta={ROLE_WORD[person.role] ?? person.role}
              actions={
                canManage && free ? (
                  <Button
                    variant={ButtonVariant.TERTIARY}
                    type="button"
                    disabled={busy}
                    onClick={() => onAssign(free.id, person.email)}
                    data-testid="give-seat"
                  >
                    {PLAN.seats.giveSeat}
                  </Button>
                ) : undefined
              }
            />
          ))}
        </ListRows>
      )}
      <Meter label={PLAN.month.customers} bar={view.customers} />
      {!canManage && <p className="ally-small">{PLAN.seats.ownerOnly}</p>}
      <ListError error={error} />
    </div>
  );
};

/**
 * Share → People → Seats (CR1 §C3): this assistant's seats, who holds each, its renewal, status
 * and this month's messages. Owners give, move or free a seat; everyone else reads. Counts only.
 */
export const AssistantSeats: React.FC<{ botId: string; canManage: boolean }> = ({
  botId,
  canManage,
}) => {
  const { data, isLoading, isError, refetch } = useGetAssistantSeatsQuery(botId);
  const [assign, { isLoading: busy }] = useAssignSeatMutation();
  const [error, setError] = useState<string | null>(null);

  if (isLoading) return <ListSkeleton />;
  if (isError) return <LoadFailed onRetry={refetch} />;
  // Nothing to show (an assistant ally-be has no seats view for): say nothing rather than fail.
  if (!data || !Array.isArray(data.seats)) return null;

  const onAssign = async (seatId: string, email: string | null) => {
    setError(null);
    try {
      await assign({ chatbotId: botId, seatId, email }).unwrap();
    } catch (failure) {
      const message = (failure as { data?: { message?: unknown } })?.data?.message;
      setError(typeof message === "string" ? message : PLAN.seats.failed);
    }
  };

  return (
    <SeatsBlock
      view={data}
      canManage={canManage}
      busy={busy}
      error={error}
      onAssign={(seatId, email) => void onAssign(seatId, email)}
    />
  );
};
