import React, { useEffect, useMemo, useState } from "react";

import { toast } from "sonner";

import { Button, Checkbox, SkeletonText } from "@ally-ui-mono/ui-shared";
import { useGetRoadmapSweepQuery, useKeepRoadmapSweepIdeasMutation } from "@api";
import { en } from "@constants";
import type { RoadmapItemRow } from "@types";

/** The banner over To do: how many old, quiet ideas there are. Nothing when there are none. */
export const TodoSweepBanner: React.FC<{ onOpen: () => void }> = ({ onOpen }) => {
  const copy = en.roadmapIdeaToPlan.sweep;
  const { data } = useGetRoadmapSweepQuery();
  if (!data || data.total === 0) return null;
  return (
    <div className="mx-4 my-2 flex flex-wrap items-center gap-2 rounded border border-border-light bg-neutral-50 px-3 py-2">
      <p className="m-0 flex-1 text-sm text-typography-primary">
        {copy.banner(data.total, data.olderThanDays)}
      </p>
      <Button kind="tertiary" size="sm" onClick={onOpen}>
        {copy.open}
      </Button>
    </div>
  );
};

interface TodoSweepPanelProps {
  /** Opens the existing bulk decline (reasons, one undo) for these rows. */
  onDecline: (rows: RoadmapItemRow[]) => void;
  onClose: () => void;
}

/**
 * The one-time sweep (idea-to-plan audit rec 9): ideas older than 60 days with at most one voter,
 * pulled up for the Owner's existing bulk review. Nothing is selected to start with and nothing
 * changes until the Owner chooses: Decline goes through the usual reason dialog (and its undo);
 * Keep stops the sweep offering an idea again and changes nothing else.
 */
export const TodoSweepPanel: React.FC<TodoSweepPanelProps> = ({ onDecline, onClose }) => {
  const copy = en.roadmapIdeaToPlan.sweep;
  const { data, isLoading, isError, refetch } = useGetRoadmapSweepQuery();
  const [keep, { isLoading: keeping }] = useKeepRoadmapSweepIdeasMutation();
  const rows = useMemo(() => (Array.isArray(data?.rows) ? data!.rows : []), [data]);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  // Rows that left the sweep (declined, kept) leave the selection too.
  useEffect(() => {
    setPicked(prev => new Set([...prev].filter(code => rows.some(r => r.code === code))));
  }, [rows]);

  const toggle = (code: string, on: boolean) =>
    setPicked(prev => {
      const next = new Set(prev);
      if (on) next.add(code);
      else next.delete(code);
      return next;
    });
  const chosen = rows.filter(r => picked.has(r.code));

  const onKeep = async () => {
    try {
      const { kept } = await keep(chosen.map(r => r.code)).unwrap();
      toast.success(copy.kept(kept));
      setPicked(new Set());
    } catch {
      toast.error(copy.keepFailed);
    }
  };

  let body: React.ReactNode;
  if (isLoading) body = <SkeletonText paragraph lineCount={4} />;
  else if (isError || !data)
    body = (
      <div className="flex items-center gap-2" role="alert">
        <p className="m-0 text-sm">{copy.loadFailed}</p>
        <Button kind="tertiary" size="sm" onClick={() => void refetch()}>
          {en.roadmapV2.retry}
        </Button>
      </div>
    );
  else if (rows.length === 0) body = <p className="m-0 text-sm">{copy.empty}</p>;
  else
    body = (
      <>
        {data.total > rows.length && (
          <p className="m-0 text-xs text-typography-secondary">
            {copy.showingFirst(rows.length, data.total)}
          </p>
        )}
        <div className="flex min-h-11 items-center">
          <Checkbox
            id="roadmap-sweep-all"
            labelText={copy.selectAll}
            checked={chosen.length === rows.length}
            indeterminate={chosen.length > 0 && chosen.length < rows.length}
            onChange={(_e: unknown, { checked }: { checked: boolean }) =>
              setPicked(checked ? new Set(rows.map(r => r.code)) : new Set())
            }
          />
        </div>
        <ul className="m-0 list-none divide-y divide-border-light p-0">
          {rows.map(row => (
            <li
              key={row.code}
              className="flex min-h-11 items-start gap-2 py-2"
              data-code={row.code}
            >
              <Checkbox
                id={`roadmap-sweep-${row.code}`}
                labelText={copy.select(row.code)}
                hideLabel
                checked={picked.has(row.code)}
                onChange={(_e: unknown, { checked }: { checked: boolean }) =>
                  toggle(row.code, checked)
                }
              />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-xs tabular-nums text-typography-secondary">{row.code}</span>
                <span className="line-clamp-2 text-sm text-typography-primary">{row.title}</span>
                {row.author?.name && (
                  <span className="text-xs text-typography-secondary">
                    {en.roadmapV2.people.wrote(row.author.name)}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      </>
    );

  return (
    <section
      aria-labelledby="roadmap-sweep-title"
      className="flex flex-col gap-3 border-b border-border-light px-4 py-3"
    >
      <div>
        <h3 id="roadmap-sweep-title" className="m-0 text-base font-semibold">
          {copy.title}
        </h3>
        <p className="m-0 text-sm text-typography-secondary">{copy.help}</p>
      </div>
      {body}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-typography-secondary" aria-live="polite">
          {copy.selected(chosen.length)}
        </span>
        <Button
          kind="danger--tertiary"
          size="sm"
          disabled={chosen.length === 0}
          onClick={() => onDecline(chosen)}
        >
          {copy.decline}
        </Button>
        <Button
          kind="secondary"
          size="sm"
          disabled={chosen.length === 0 || keeping}
          onClick={() => void onKeep()}
        >
          {copy.keep}
        </Button>
        <Button kind="tertiary" size="sm" className="ml-auto" onClick={onClose}>
          {copy.close}
        </Button>
      </div>
    </section>
  );
};
