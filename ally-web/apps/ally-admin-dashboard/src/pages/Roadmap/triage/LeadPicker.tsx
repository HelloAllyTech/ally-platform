import React, { useEffect, useState } from "react";

import { SkeletonText, Tag } from "@ally-ui-mono/ui-shared";
import { en } from "@constants";

import { useGetRoadmapLeadSuggestionsQuery } from "../../../api/roadmapV2Flow";
import { RoadmapDialog } from "../components/RoadmapDialog";

import type { RoadmapLeadCandidate } from "../../../types/roadmapV2Flow";

/** "2 of 3 slots free · built 4 admin ideas" (contract copy). */
export const leadWhy = (c: RoadmapLeadCandidate): string =>
  en.roadmapV2.review.leadWhy(
    Math.max(0, c.freeSlots),
    c.limit,
    c.matchingIdeas,
    c.matchingIdeas > 0 ? (c.appsTouched?.[0] ?? "") : "",
  );

/** Best first, with the suggested Builder on top whatever the server's order. */
export const orderCandidates = (
  candidates: RoadmapLeadCandidate[],
  suggestedUserId: number | null,
): RoadmapLeadCandidate[] => {
  const list = [...candidates].sort((a, b) => b.score - a.score);
  const index = list.findIndex(c => c.user.id === suggestedUserId);
  if (index > 0) list.unshift(...list.splice(index, 1));
  return list;
};

interface LeadPickerProps {
  open: boolean;
  /** The idea the suggestion is scored for (the first, in a bulk pick). */
  code: string;
  count?: number;
  /** Accept + lead says so on its button. */
  accepting?: boolean;
  onClose: () => void;
  onPick: (lead: { id: number; name: string }) => Promise<boolean>;
  sheet: boolean;
}

/**
 * The lead picker (§4.6, §4.11): Builders with how many ideas each leads against the limit, the
 * suggested one first and pre-selected, with why — "2 of 3 slots free · built 4 admin ideas".
 */
export const LeadPicker: React.FC<LeadPickerProps> = ({
  open,
  code,
  count = 1,
  accepting,
  onClose,
  onPick,
  sheet,
}) => {
  const copy = en.roadmapV2.review;
  const { data, isLoading, isError } = useGetRoadmapLeadSuggestionsQuery(code, {
    skip: !open || !code,
  });
  const candidates = orderCandidates(
    Array.isArray(data?.candidates) ? data!.candidates : [],
    data?.suggestedUserId ?? null,
  );
  const [chosen, setChosen] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  useEffect(() => {
    if (open) setChosen(data?.suggestedUserId ?? candidates[0]?.user.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, data?.suggestedUserId]);

  const person = candidates.find(c => c.user.id === chosen)?.user;
  const confirm = async () => {
    if (!person || sending) return;
    setSending(true);
    const ok = await onPick({ id: person.id, name: person.name });
    setSending(false);
    if (ok) onClose();
  };

  return (
    <RoadmapDialog
      open={open}
      onClose={onClose}
      title={count > 1 ? copy.leadTitleMany(count) : copy.leadTitle(code)}
      primaryText={accepting ? copy.leadAcceptConfirm : copy.leadConfirm}
      onPrimary={() => void confirm()}
      primaryDisabled={!person || sending}
      secondaryText={copy.cancel}
      sheet={sheet}
      closeLabel={copy.cancel}
    >
      <div className="flex flex-col gap-2">
        <p className="m-0 text-sm text-typography-secondary">{copy.leadIntro}</p>
        {isLoading && <SkeletonText paragraph lineCount={3} />}
        {isError && <p className="m-0 text-sm text-typography-primary">{copy.leadLoadError}</p>}
        {!isLoading && !isError && candidates.length === 0 && (
          <p className="m-0 text-sm text-typography-secondary">{copy.leadNone}</p>
        )}
        <div role="radiogroup" aria-label={copy.pickLead} className="flex flex-col gap-1">
          {candidates.map(c => {
            const selected = chosen === c.user.id;
            return (
              <label
                key={c.user.id}
                className={`flex min-h-12 cursor-pointer items-center gap-3 rounded border px-3 py-2 ${
                  selected ? "border-primary-600 bg-primary-50" : "border-border-light"
                }`}
              >
                <input
                  type="radio"
                  name={`roadmap-lead-${code}`}
                  checked={selected}
                  onChange={() => setChosen(c.user.id)}
                  className="h-4 w-4"
                />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex items-center gap-2 text-sm text-typography-primary">
                    {c.user.name}
                    {c.user.id === data?.suggestedUserId && (
                      <Tag type="green" size="sm" className="!m-0">
                        {copy.leadSuggested}
                      </Tag>
                    )}
                  </span>
                  <span className="text-xs text-typography-secondary">
                    {c.freeSlots > 0 ? leadWhy(c) : copy.leadFull}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </div>
    </RoadmapDialog>
  );
};
