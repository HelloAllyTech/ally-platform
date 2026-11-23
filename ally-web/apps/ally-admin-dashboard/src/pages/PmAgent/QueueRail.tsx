import React from "react";

import type { PmCard } from "@types";

import { copy } from "./copy";
import { isNeedsYou } from "./format";

export interface QueueRailProps {
  cards: PmCard[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/**
 * The queue: one row per card with a kind icon and a word for its status. Rows are buttons, so
 * nothing interactive (Carbon Tag renders a button) is nested inside them.
 */
export const QueueRail: React.FC<QueueRailProps> = ({ cards, selectedId, onSelect }) => (
  <nav aria-label={copy.queueLabel}>
    <ul className="flex flex-col gap-1">
      {cards.map(card => {
        const needs = isNeedsYou(card);
        const selected = card.id === selectedId;
        return (
          <li key={card.id}>
            <button
              type="button"
              aria-current={selected ? "true" : undefined}
              onClick={() => onSelect(card.id)}
              className={`flex min-h-11 w-full cursor-pointer items-start gap-2 rounded border p-2 text-left text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-600 ${
                selected
                  ? "border-primary-600 bg-primary-50 text-typography-900"
                  : "border-neutral-500 bg-white text-typography-800 hover:bg-neutral-100"
              }`}
            >
              <span aria-hidden="true" className="mt-0.5 w-4 shrink-0">
                {needs ? "⚠" : card.kind === "question" ? "?" : "◆"}
              </span>
              <span className="flex flex-col">
                <span className="font-medium">{card.title}</span>
                <span className="text-xs text-typography-600">
                  {needs ? copy.needsYouTag : copy.kind[card.kind]}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  </nav>
);
