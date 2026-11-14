import React, { useEffect, useMemo, useRef, useState } from "react";

import { useGetReadyMadeListsQuery, useGetUserListsQuery } from "@api";
import { Button, Skeleton } from "@components/v2";
import type { UserList } from "@types";

import { HOME, fill } from "../copy";
import { CollapsibleGroup, SectionHead } from "../fields";
import { AssistantBlock, assistantSummary } from "./AssistantBlock";
import { DetailsBlock } from "./DetailsBlock";
import { EntriesTable } from "./EntriesTable";
import { exampleOptions } from "./examples";
import { liveFields, lower } from "./format";
import { NewListForm } from "./NewListForm";
import { ReadyMadeSetup } from "./ReadyMadeSetup";
import { RulesBlock } from "./RulesBlock";
import { Sheet } from "../ui/Sheet";

import type { SectionProps } from "../sections/props";
import "./lists.css";

const t = () => HOME.userLists;

type Mode = { kind: "lists" } | { kind: "setup" } | { kind: "scratch" };

/**
 * Lists (chunk 5b): the owner's own tables. No lists yet: two ways to start. With lists: a tab
 * per list and Add a list; the open list shows its entries, then its details, rules and what the
 * assistant may do. Switching assistant remounts the home (it's keyed by bot), so the open tab
 * starts again at the first list.
 */
export const ListsSection: React.FC<SectionProps> = ({ bot, canEdit, tryIt }) => {
  const { data: lists, isLoading, isError, refetch } = useGetUserListsQuery(bot.id);
  const { data: catalogue } = useGetReadyMadeListsQuery(bot.id, { skip: !canEdit });
  const [mode, setMode] = useState<Mode>({ kind: "lists" });
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const live = useMemo(() => (lists ?? []).filter(l => !l.deleted_at), [lists]);
  const current = live.find(l => l.key === open) ?? live[0] ?? null;

  return (
    <div className="ally-home__section ally-lists">
      <SectionHead title={t().title} subtitle={t().subtitle} help={t().help} />

      {mode.kind === "setup" && catalogue ? (
        <ReadyMadeSetup
          bot={bot}
          catalogue={catalogue}
          lists={live}
          onClose={key => {
            setMode({ kind: "lists" });
            if (key) setOpen(key);
          }}
          tryIt={tryIt}
        />
      ) : mode.kind === "scratch" ? (
        <NewListForm
          botId={bot.id}
          lists={live}
          onClose={key => {
            setMode({ kind: "lists" });
            if (key) setOpen(key);
          }}
        />
      ) : isLoading ? (
        <ListsSkeleton />
      ) : isError ? (
        <div className="ally-card ally-lists__problem" role="alert">
          <p>{t().table.loadFailed}</p>
          <Button onClick={() => void refetch()}>{t().table.retry}</Button>
        </div>
      ) : !live.length ? (
        <EmptyLists
          canEdit={canEdit}
          onReadyMade={() => setMode({ kind: "setup" })}
          onScratch={() => setMode({ kind: "scratch" })}
        />
      ) : (
        <>
          <ListTabs
            lists={live}
            current={current}
            onOpen={setOpen}
            onAdd={canEdit ? () => setAdding(true) : undefined}
          />
          {current && (
            <OpenList
              key={current.key}
              bot={bot}
              list={current}
              lists={live}
              canEdit={canEdit}
              needsOptions={exampleOptions(current, catalogue)}
            />
          )}
        </>
      )}

      {adding && (
        <Sheet label={t().tabs.addTitle} side="center" onClose={() => setAdding(false)}>
          <div className="ally-lists__add-sheet">
            <h2 className="ally-heading">{t().tabs.addTitle}</h2>
            <StartChoices
              onReadyMade={() => {
                setAdding(false);
                setMode({ kind: "setup" });
              }}
              onScratch={() => {
                setAdding(false);
                setMode({ kind: "scratch" });
              }}
            />
          </div>
        </Sheet>
      )}
    </div>
  );
};

const StartChoices: React.FC<{ onReadyMade: () => void; onScratch: () => void }> = ({
  onReadyMade,
  onScratch,
}) => (
  <div className="ally-lists__starts">
    <button type="button" className="ally-lists__start ally-press" onClick={onReadyMade}>
      <span className="ally-lists__start-icon" aria-hidden="true">
        ✦
      </span>
      <span className="ally-lists__start-title">{t().empty.readyMade}</span>
      <span className="ally-small">{t().empty.readyMadeHint}</span>
    </button>
    <button type="button" className="ally-lists__start ally-press" onClick={onScratch}>
      <span className="ally-lists__start-icon" aria-hidden="true">
        +
      </span>
      <span className="ally-lists__start-title">{t().empty.scratch}</span>
      <span className="ally-small">{t().empty.scratchHint}</span>
    </button>
  </div>
);

const EmptyLists: React.FC<{
  canEdit: boolean;
  onReadyMade: () => void;
  onScratch: () => void;
}> = ({ canEdit, onReadyMade, onScratch }) => (
  <div className="ally-card ally-lists__empty" data-testid="lists-empty">
    <div className="ally-lists__empty-art" aria-hidden="true">
      <span />
      <span />
      <span />
    </div>
    <h3 className="ally-lists__empty-title">{t().empty.title}</h3>
    <p className="ally-lists__empty-body">{t().empty.body}</p>
    {canEdit && <StartChoices onReadyMade={onReadyMade} onScratch={onScratch} />}
  </div>
);

/** One tab per list, then Add a list. Arrow keys move between tabs. */
const ListTabs: React.FC<{
  lists: UserList[];
  current: UserList | null;
  onOpen: (key: string) => void;
  onAdd?: () => void;
}> = ({ lists, current, onOpen, onAdd }) => {
  const row = useRef<HTMLDivElement>(null);
  const focusTab = (index: number) => {
    const tabs = row.current?.querySelectorAll<HTMLButtonElement>("[role=tab]");
    const tab = tabs?.[(index + lists.length) % lists.length];
    tab?.focus();
    tab?.click();
  };
  useEffect(() => {
    row.current
      ?.querySelector<HTMLElement>("[aria-selected=true]")
      ?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [current?.key]);
  return (
    <div className="ally-lists__tabbar">
      <div ref={row} className="ally-lists__tabs" role="tablist" aria-label={t().tabs.label}>
        {lists.map((list, index) => {
          const selected = list.key === current?.key;
          return (
            <button
              key={list.key}
              type="button"
              role="tab"
              id={`list-tab-${list.key}`}
              aria-selected={selected}
              aria-controls={`list-panel-${list.key}`}
              tabIndex={selected ? 0 : -1}
              className="ally-lists__tab"
              onClick={() => onOpen(list.key)}
              onKeyDown={event => {
                if (event.key === "ArrowRight") focusTab(index + 1);
                if (event.key === "ArrowLeft") focusTab(index - 1);
              }}
            >
              <span>{list.name}</span>
              <span className="ally-lists__tab-count">{list.record_count}</span>
            </button>
          );
        })}
      </div>
      {onAdd && (
        <Button className="ally-lists__add-list" onClick={onAdd}>
          <span aria-hidden="true">+ </span>
          {t().tabs.add}
        </Button>
      )}
    </div>
  );
};

const OpenList: React.FC<{
  bot: SectionProps["bot"];
  list: UserList;
  lists: UserList[];
  canEdit: boolean;
  needsOptions: { field: string; label: string } | null;
}> = ({ bot, list, lists, canEdit, needsOptions }) => {
  const [focusDetail, setFocusDetail] = useState<string | null>(null);
  const details = liveFields(list);
  return (
    <div
      id={`list-panel-${list.key}`}
      role="tabpanel"
      aria-labelledby={`list-tab-${list.key}`}
      className="ally-lists__panel"
    >
      {needsOptions && canEdit && (
        <div className="ally-lists__notice" role="status">
          <p>{fill(t().table.replaceOptions, { detail: lower(needsOptions.label) })}</p>
          <Button onClick={() => setFocusDetail(needsOptions.field)}>
            {t().table.replaceAction}
          </Button>
        </div>
      )}
      <EntriesTable bot={bot} list={list} lists={lists} canEdit={canEdit} />
      <CollapsibleGroup
        title={t().blocks.details}
        hint={t().blocks.detailsHint}
        summary={details.map(f => f.label).join(" · ")}
        defaultOpen={focusDetail !== null}
        key={`details-${focusDetail ?? ""}`}
        testId="list-details"
      >
        <DetailsBlock
          botId={bot.id}
          list={list}
          lists={lists}
          canEdit={canEdit}
          focus={focusDetail}
        />
      </CollapsibleGroup>
      <CollapsibleGroup
        title={t().blocks.rules}
        hint={t().blocks.rulesHint}
        summary={
          list.rules.length === 1
            ? t().rules.countOne
            : fill(t().rules.count, { n: list.rules.length })
        }
        testId="list-rules"
      >
        <RulesBlock bot={bot} list={list} lists={lists} canEdit={canEdit} />
      </CollapsibleGroup>
      <CollapsibleGroup
        title={t().blocks.assistant}
        hint={t().blocks.assistantHint}
        summary={assistantSummary(list)}
        testId="list-assistant"
      >
        <AssistantBlock botId={bot.id} list={list} lists={lists} canEdit={canEdit} />
      </CollapsibleGroup>
    </div>
  );
};

const ListsSkeleton: React.FC = () => (
  <div className="ally-lists__skeleton" aria-busy="true">
    <div className="ally-lists__tabbar">
      <Skeleton width="120px" height={36} />
      <Skeleton width="120px" height={36} />
    </div>
    <div className="ally-card">
      {[0, 1, 2, 3, 4].map(i => (
        <div key={i} className="ally-lists__skeleton-row">
          <Skeleton width="30%" />
          <Skeleton width="20%" />
          <Skeleton width="15%" />
        </div>
      ))}
    </div>
  </div>
);
