import React, { useState } from "react";

import { useGetRoadmapOpportunityQuery, useGetRoadmapVoteBudgetQuery } from "@api";
import { en } from "@constants";

import { VoteButton } from "./VoteButton";
import { useRoadmapVote } from "../hooks/useRoadmapVote";

interface VoteControlProps {
  /** The opportunity uuid (ItemRow.id): what the vote endpoint takes. */
  id: string;
  code: string;
  /** The idea's total, as the read model counts it. */
  votes: number;
  votedByMe: boolean;
  canVote: boolean;
  /**
   * Rows: show the total until the reader reaches for it (hover, focus or tap), then load the
   * caller's own vote count and swap in the real control. VoteButton sends an ABSOLUTE total, and
   * a row only knows "voted or not", so it must never act on a guessed count — and loading the
   * record for every row up front would be one request per row.
   */
  lazy?: boolean;
  orientation?: "horizontal" | "vertical";
}

const Count: React.FC<{ votes: number; votedByMe: boolean }> = ({ votes, votedByMe }) => {
  const copy = en.roadmapV2.row;
  return (
    <span
      className={`text-xs tabular-nums ${votedByMe ? "font-semibold text-primary-700" : "text-typography-secondary"}`}
    >
      <span aria-hidden>▲{votes}</span>
      <span className="sr-only">
        {copy.votes(votes)}
        {votedByMe ? `, ${copy.votedByMe}` : ""}
      </span>
    </span>
  );
};

/**
 * Voting, unchanged (D17): the existing VoteButton on the existing vote endpoint, optimistic
 * everywhere the vote shows (see useRoadmapVote). VoteButton keeps its own rules — it locks once an
 * idea leaves the board's `new` stage, and debounces a burst of taps into one write.
 */
export const VoteControl: React.FC<VoteControlProps> = ({
  id,
  code,
  votes,
  votedByMe,
  canVote,
  lazy = false,
  orientation = "horizontal",
}) => {
  const [active, setActive] = useState(!lazy);
  const live = canVote && !!id && active;
  const { data: opportunity } = useGetRoadmapOpportunityQuery(id, { skip: !live });
  const { data: budget } = useGetRoadmapVoteBudgetQuery(undefined, { skip: !live });
  const onSetVotes = useRoadmapVote(code);
  const copy = en.roadmapV2.row;

  if (!canVote || !id) return <Count votes={votes} votedByMe={votedByMe} />;

  if (!active) {
    const wake = () => setActive(true);
    return (
      <button
        type="button"
        onPointerEnter={wake}
        onFocus={wake}
        onClick={wake}
        aria-label={`${copy.vote}: ${copy.votes(votes)}${votedByMe ? `, ${copy.votedByMe}` : ""}`}
        className="inline-flex min-h-8 min-w-8 items-center justify-center rounded px-1 hover:bg-neutral-100"
      >
        <Count votes={votes} votedByMe={votedByMe} />
      </button>
    );
  }

  if (!opportunity || !budget) return <Count votes={votes} votedByMe={votedByMe} />;

  return (
    <span className="inline-flex items-center gap-1">
      <VoteButton
        opportunity={opportunity}
        budget={budget}
        onSetVotes={onSetVotes}
        orientation={orientation}
      />
      <Count votes={votes} votedByMe={votedByMe} />
    </span>
  );
};
