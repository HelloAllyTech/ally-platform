import React from "react";

import { Button } from "@ally-ui-mono/ui-shared";
import { en } from "@constants";

import type { RoadmapDraftDetail } from "../../../types/roadmapV2Flow";

interface SplitCardProps {
  draft: RoadmapDraftDetail;
  splitting: boolean;
  readOnly: boolean;
  onSplit: () => void;
  onOpen: (code: string) => void;
}

/**
 * "This is bigger than one idea": the interview's proposed slices, with one button that turns them
 * into sibling drafts. Once split it lists those drafts instead and the parent stops being
 * submittable. Renders nothing for an idea that files as one.
 */
export const SplitCard: React.FC<SplitCardProps> = ({
  draft,
  splitting,
  readOnly,
  onSplit,
  onOpen,
}) => {
  const copy = en.roadmapV2.draft.split;
  const slices = Array.isArray(draft.slices) ? draft.slices : [];
  const children = Array.isArray(draft.splitInto) ? draft.splitInto : [];

  if (children.length > 0) {
    return (
      <section
        aria-label={copy.doneTitle}
        className="flex flex-col gap-2 rounded-lg border border-border-light p-4"
      >
        <h2 className="m-0 text-sm font-semibold text-typography-primary">{copy.doneTitle}</h2>
        <p className="m-0 text-sm text-typography-secondary">{copy.doneBody}</p>
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {children.map(child => (
            <li key={child.code} className="flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0 truncate text-typography-primary">
                <span className="tabular-nums text-typography-secondary">{child.code}</span>{" "}
                {child.title}
              </span>
              <Button
                kind="tertiary"
                size="sm"
                aria-label={`${copy.open(child.code)}: ${child.title}`}
                onClick={() => onOpen(child.code)}
              >
                {copy.open(child.code)}
              </Button>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  if (slices.length < 2) return null;

  return (
    <section
      aria-label={copy.title}
      className="flex flex-col gap-3 rounded-lg border border-primary-600 p-4"
    >
      <h2 className="m-0 text-sm font-semibold text-typography-primary">{copy.title}</h2>
      <p className="m-0 text-sm text-typography-secondary">{copy.intro(slices.length)}</p>
      <ol className="m-0 flex list-none flex-col gap-2 p-0">
        {slices.map((slice, i) => (
          <li
            key={`${i}-${slice.title ?? slice.description.slice(0, 20)}`}
            className="flex flex-col gap-0.5 rounded border border-border-light p-2"
          >
            <span className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-medium text-typography-primary">
                {slice.title || slice.description.split("\n")[0].slice(0, 80)}
              </span>
              <span className="shrink-0 text-xs text-typography-secondary">
                {copy.sliceSize(slice.effort)}
              </span>
            </span>
            {slice.title && (
              <span className="text-xs text-typography-secondary">{slice.description}</span>
            )}
          </li>
        ))}
      </ol>
      {!readOnly && (
        <Button
          kind="primary"
          size="md"
          className="self-start"
          disabled={splitting}
          onClick={onSplit}
        >
          {splitting ? copy.splitting : copy.button(slices.length)}
        </Button>
      )}
    </section>
  );
};
