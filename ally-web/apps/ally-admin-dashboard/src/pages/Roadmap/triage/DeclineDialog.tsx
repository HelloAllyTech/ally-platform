import React, { useEffect, useMemo, useState } from "react";

import { Tag, TextArea } from "@ally-ui-mono/ui-shared";
import { en } from "@constants";

import { useGetRoadmapItemSimilarQuery } from "../../../api/roadmapV2Flow";
import { RoadmapDialog } from "../components/RoadmapDialog";

export const DECLINE_REASON_MAX = 300;

export interface DeclineTarget {
  code: string;
  title: string;
  goalName?: string;
}

/**
 * The decline templates (§4.6), written as what would make the idea stronger, speaking to the idea
 * and not the person (§4.14). When the idea overlaps another, "Overlaps OPP-212" is suggested and
 * pre-selected (§4.11, §4.17 "with the suggested reason pre-selected").
 */
export const declineTemplates = (overlapCode?: string, goalName?: string): string[] => {
  const t = en.roadmapV2.review.templates;
  return [
    overlapCode ? t.overlaps(overlapCode) : t.overlapsGeneric,
    t.evidence,
    goalName ? t.goals(goalName) : t.goalsGeneric,
    t.tooSmall,
  ];
};

interface DeclineDialogProps {
  open: boolean;
  targets: DeclineTarget[];
  onClose: () => void;
  /** Resolves true when the declines went through. */
  onDecline: (reasons: Record<string, string>) => Promise<boolean>;
  sheet: boolean;
}

/**
 * Decline opens a reason box with templates. Bulk decline asks for one reason for all of them,
 * editable per idea before sending (§4.11). The author alone sees the reason [FP-0992].
 */
export const DeclineDialog: React.FC<DeclineDialogProps> = ({
  open,
  targets,
  onClose,
  onDecline,
  sheet,
}) => {
  const copy = en.roadmapV2.review;
  const first = targets[0];
  const { data: similar } = useGetRoadmapItemSimilarQuery(first?.code ?? "", {
    skip: !open || targets.length !== 1 || !first,
  });
  const overlap = Array.isArray(similar?.matches) ? similar!.matches[0]?.code : undefined;
  const templates = useMemo(
    () => declineTemplates(overlap, targets.length === 1 ? first?.goalName : undefined),
    [overlap, first, targets.length],
  );

  const [reason, setReason] = useState("");
  const [perIdea, setPerIdea] = useState<Record<string, string> | null>(null);
  const [touched, setTouched] = useState(false);
  const [sending, setSending] = useState(false);

  // Fresh box each time it opens; the overlap suggestion is pre-selected once it's known.
  useEffect(() => {
    if (!open) return;
    setReason("");
    setPerIdea(null);
    setTouched(false);
    setSending(false);
  }, [open]);
  useEffect(() => {
    if (open && overlap && !touched) setReason(declineTemplates(overlap)[0]);
  }, [open, overlap, touched]);

  const reasons = (): Record<string, string> =>
    Object.fromEntries(targets.map(t => [t.code, (perIdea?.[t.code] ?? reason).trim()]));
  const valid = Object.values(reasons()).every(r => r.length > 0 && r.length <= DECLINE_REASON_MAX);

  const send = async () => {
    if (!valid || sending) return;
    setSending(true);
    const ok = await onDecline(reasons());
    setSending(false);
    if (ok) onClose();
  };

  return (
    <RoadmapDialog
      open={open}
      onClose={onClose}
      title={
        targets.length === 1 && first
          ? copy.declineTitle(first.code)
          : copy.declineTitleMany(targets.length)
      }
      primaryText={targets.length > 1 ? copy.declineSendMany(targets.length) : copy.declineSend}
      onPrimary={() => void send()}
      primaryDisabled={!valid || sending}
      secondaryText={copy.cancel}
      danger
      sheet={sheet}
      closeLabel={copy.cancel}
    >
      <div className="flex flex-col gap-3">
        <p className="m-0 text-sm text-typography-secondary">{copy.declineIntro}</p>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-typography-secondary">{copy.declineTemplates}</span>
          <div className="flex flex-wrap gap-1">
            {templates.map(template => (
              <button
                key={template}
                type="button"
                onClick={() => {
                  setTouched(true);
                  setReason(template);
                  setPerIdea(null);
                }}
                aria-pressed={reason === template}
                className="rounded-full"
              >
                <Tag
                  type={reason === template ? "blue" : "gray"}
                  size="md"
                  className="!m-0 cursor-pointer"
                >
                  {template}
                </Tag>
              </button>
            ))}
          </div>
        </div>
        <TextArea
          id="roadmap-decline-reason"
          labelText={copy.declineReason}
          rows={3}
          maxCount={DECLINE_REASON_MAX}
          enableCounter
          value={reason}
          invalid={touched && !reason.trim()}
          invalidText={copy.reasonRequired}
          onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => {
            setTouched(true);
            setReason(event.target.value.slice(0, DECLINE_REASON_MAX));
          }}
        />
        {targets.length > 1 && (
          <details
            open={!!perIdea}
            onToggle={event => {
              if ((event.target as HTMLDetailsElement).open && !perIdea) {
                setPerIdea(Object.fromEntries(targets.map(t => [t.code, reason])));
              }
            }}
          >
            <summary className="cursor-pointer text-sm text-primary-700">
              {copy.declinePerIdea}
            </summary>
            <div className="mt-2 flex flex-col gap-2">
              {targets.map(t => (
                <TextArea
                  key={t.code}
                  id={`roadmap-decline-${t.code}`}
                  labelText={`${t.code} · ${t.title}`}
                  rows={2}
                  maxCount={DECLINE_REASON_MAX}
                  enableCounter
                  value={perIdea?.[t.code] ?? reason}
                  onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) =>
                    setPerIdea(p => ({
                      ...(p ?? {}),
                      [t.code]: event.target.value.slice(0, DECLINE_REASON_MAX),
                    }))
                  }
                />
              ))}
            </div>
          </details>
        )}
      </div>
    </RoadmapDialog>
  );
};
