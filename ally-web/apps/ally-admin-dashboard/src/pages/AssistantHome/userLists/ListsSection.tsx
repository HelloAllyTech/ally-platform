import React, { useEffect, useMemo, useRef, useState } from "react";

import { useGetHowItWorksQuery, useGetReadyMadeListsQuery, useGetUserListsQuery } from "@api";
import { Button } from "@components/button";
import { ButtonVariant } from "@components/types";
import { Skeleton } from "@components/v2";
import type { UserList } from "@types";

import { TEMPLATE_COPY } from "../../Templates/copy";
import { HOME, fill } from "../copy";
import { CollapsibleGroup, SectionHead } from "../fields";
import { AssistantBlock, assistantSummary } from "./AssistantBlock";
import { DetailsBlock } from "./DetailsBlock";
import { EntriesTable } from "./EntriesTable";
import { exampleOptions } from "./examples";
import { human, liveFields, lower } from "./format";
import { HandOverAbility } from "./HandOverAbility";
import { ListMenu } from "./ListMenu";
import { NewListForm } from "./NewListForm";
import { ReadyMadeSetup } from "./ReadyMadeSetup";
import { RulesBlock } from "./RulesBlock";
import { TemplateAdd } from "./TemplateAdd";
import { MemorySettings } from "../sections/MemorySettings";
import { Sheet } from "../ui/Sheet";

import type { SectionProps } from "../sections/props";

import "./lists.css";

const t = () => HOME.userLists;

type Mode = { kind: "lists" } | { kind: "setup" } | { kind: "scratch" } | { kind: "template" };

/**
 * Lists (chunk 5b): the owner's own tables. No lists yet: two ways to start. With lists: a tab
 * per list and Add a list; the open list shows its entries, then its details, rules and what the
 * assistant may do. Switching assistant remounts the home (it's keyed by bot), so the open tab
 * starts again at the first list.
 */
export const ListsSection: React.FC<
  SectionProps & {
    /**
     * The assistant's own tools (pages, memory, hand over) ahead of the lists. Off in Knowledge,
     * where they moved: memory and hand over to Settings, pages to Channels (stage 2).
     */
    withTools?: boolean;
    /** A list to open first (`?tool=<key>`). */
    openKey?: string | null;
  }
> = ({ bot, home, canEdit, canManage, go, tryIt, withTools = true, openKey = null }) => {
  const { data: lists, isLoading, isError, refetch } = useGetUserListsQuery(bot.id);
  const { data: catalogue } = useGetReadyMadeListsQuery(bot.id, { skip: !canEdit });
  const [mode, setMode] = useState<Mode>({ kind: "lists" });
  // A tool of the assistant's own (`@pages`, `@memory`, `@handover`) or a list's key (chunk 8a).
  // `?tool=memory` opens Memory (the Inbox's links).
  const [open, setOpen] = useState<string | null>(() => {
    // Read from the address itself, so the section needs no router of its own.
    const tool = openKey ?? new URLSearchParams(window.location.search).get("tool");
    if (!tool) return null;
    if (BUILT_IN.includes(`@${tool}` as BuiltIn)) return withTools ? `@${tool}` : null;
    return tool;
  });
  const [adding, setAdding] = useState(false);

  const live = useMemo(() => (lists ?? []).filter(l => !l.deleted_at), [lists]);
  const builtIn =
    withTools && open && BUILT_IN.includes(open as BuiltIn) ? (open as BuiltIn) : null;
  const current = builtIn ? null : (live.find(l => l.key === open) ?? live[0] ?? null);

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
      ) : mode.kind === "template" ? (
        <TemplateAdd
          bot={bot}
          onClose={() => setMode({ kind: "lists" })}
          onRunCheckup={() => go("build", "checkup")}
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
          <Button variant={ButtonVariant.TERTIARY} type="button" onClick={() => void refetch()}>
            {t().table.retry}
          </Button>
        </div>
      ) : (
        <>
          <ListTabs
            home={home}
            lists={live}
            current={current}
            builtIn={builtIn}
            withTools={withTools}
            onOpen={setOpen}
            onAdd={canEdit ? () => setAdding(true) : undefined}
          />
          {builtIn ? (
            <BuiltInPanel
              tool={builtIn}
              bot={bot}
              home={home}
              canEdit={canEdit}
              canManage={canManage}
              go={go}
            />
          ) : current ? (
            <OpenList
              key={current.key}
              bot={bot}
              list={current}
              lists={live}
              canEdit={canEdit}
              needsOptions={exampleOptions(current, catalogue)}
              onDeleted={() => setOpen(null)}
            />
          ) : (
            <EmptyLists
              canEdit={canEdit}
              onReadyMade={() => setMode({ kind: "setup" })}
              onScratch={() => setMode({ kind: "scratch" })}
              onTemplate={canManage ? () => setMode({ kind: "template" }) : undefined}
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
              onTemplate={
                canManage
                  ? () => {
                      setAdding(false);
                      setMode({ kind: "template" });
                    }
                  : undefined
              }
            />
          </div>
        </Sheet>
      )}
    </div>
  );
};

const StartChoices: React.FC<{
  onReadyMade: () => void;
  onScratch: () => void;
  /** Owners: Add from a template (T1). */
  onTemplate?: () => void;
}> = ({ onReadyMade, onScratch, onTemplate }) => (
  <div className="ally-lists__starts">
    {onTemplate && (
      <Button
        variant={ButtonVariant.TEXT}
        type="button"
        className="ally-lists__start ally-press !h-auto"
        onClick={onTemplate}
        data-testid="lists-start-template"
      >
        <span className="ally-lists__start-icon" aria-hidden="true">
          🧩
        </span>
        <span className="ally-lists__start-title">{TEMPLATE_COPY.tools.title}</span>
        <span className="ally-small">{TEMPLATE_COPY.tools.hint}</span>
      </Button>
    )}
    <Button
      variant={ButtonVariant.TEXT}
      type="button"
      className="ally-lists__start ally-press !h-auto"
      onClick={onReadyMade}
    >
      <span className="ally-lists__start-icon" aria-hidden="true">
        ✦
      </span>
      <span className="ally-lists__start-title">{t().empty.readyMade}</span>
      <span className="ally-small">{t().empty.readyMadeHint}</span>
    </Button>
    <Button
      variant={ButtonVariant.TEXT}
      type="button"
      className="ally-lists__start ally-press !h-auto"
      onClick={onScratch}
    >
      <span className="ally-lists__start-icon" aria-hidden="true">
        +
      </span>
      <span className="ally-lists__start-title">{t().empty.scratch}</span>
      <span className="ally-small">{t().empty.scratchHint}</span>
    </Button>
  </div>
);

const EmptyLists: React.FC<{
  canEdit: boolean;
  onReadyMade: () => void;
  onScratch: () => void;
  onTemplate?: () => void;
}> = ({ canEdit, onReadyMade, onScratch, onTemplate }) => (
  <div className="ally-card ally-lists__empty" data-testid="lists-empty">
    <div className="ally-lists__empty-art" aria-hidden="true">
      <span />
      <span />
      <span />
    </div>
    <h3 className="ally-lists__empty-title">{t().empty.title}</h3>
    <p className="ally-lists__empty-body">{t().empty.body}</p>
    {canEdit && (
      <StartChoices onReadyMade={onReadyMade} onScratch={onScratch} onTemplate={onTemplate} />
    )}
  </div>
);

/** The assistant's own tools (chunk 8a), shown before the owner's lists. */
const BUILT_IN = ["@pages", "@memory", "@handover"] as const;
type BuiltIn = (typeof BUILT_IN)[number];

/**
 * One tab per tool: the assistant's own (its pages, memory, hand over), then one per list, then
 * Add a tool. Arrow keys move between tabs. Lists keep their `list-tab-` ids (chunk 5b).
 */
const ListTabs: React.FC<{
  home: SectionProps["home"];
  lists: UserList[];
  current: UserList | null;
  builtIn: BuiltIn | null;
  withTools: boolean;
  onOpen: (key: string) => void;
  onAdd?: () => void;
}> = ({ home, lists, current, builtIn, withTools, onOpen, onAdd }) => {
  const row = useRef<HTMLDivElement>(null);
  const toolTabs: { id: string; label: string; tag?: string; domId: string }[] = [
    {
      id: "@pages",
      label: t().tools.pages,
      domId: "tool-tab-pages",
    },
    {
      id: "@memory",
      label: t().tools.memory,
      tag: home?.fields?.memory
        ? home.fields.memory.value.on
          ? t().tools.on
          : t().tools.off
        : undefined,
      domId: "tool-tab-memory",
    },
    { id: "@handover", label: t().tools.handover, domId: "tool-tab-handover" },
  ];
  const tabs: { id: string; label: string; tag?: string; domId: string }[] = [
    ...(withTools ? toolTabs : []),
    ...lists.map(list => ({
      id: list.key,
      label: list.name,
      tag: String(list.record_count),
      domId: `list-tab-${list.key}`,
    })),
  ];
  const selectedId = builtIn ?? current?.key ?? null;
  const focusTab = (index: number) => {
    const all = row.current?.querySelectorAll<HTMLButtonElement>("[role=tab]");
    const tab = all?.[(index + tabs.length) % tabs.length];
    tab?.focus();
    tab?.click();
  };
  useEffect(() => {
    row.current
      ?.querySelector<HTMLElement>("[aria-selected=true]")
      ?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [selectedId]);
  return (
    <div className="ally-lists__tabbar">
      <div ref={row} className="ally-lists__tabs" role="tablist" aria-label={t().tools.label}>
        {tabs.map((tab, index) => {
          const selected = tab.id === selectedId;
          return (
            <Button
              variant={ButtonVariant.TEXT}
              key={tab.id}
              type="button"
              role="tab"
              id={tab.domId}
              aria-selected={selected}
              aria-controls={tab.domId.replace("-tab-", "-panel-")}
              tabIndex={selected || (!selectedId && index === 0) ? 0 : -1}
              className={`ally-lists__tab${tab.id.startsWith("@") ? " ally-lists__tab--tool" : ""} !h-auto`}
              onClick={() => onOpen(tab.id)}
              onKeyDown={event => {
                if (event.key === "ArrowRight") focusTab(index + 1);
                if (event.key === "ArrowLeft") focusTab(index - 1);
              }}
            >
              <span>{tab.label}</span>
              {tab.tag && <span className="ally-lists__tab-count">{tab.tag}</span>}
            </Button>
          );
        })}
      </div>
      {onAdd && (
        <Button
          variant={ButtonVariant.TERTIARY}
          type="button"
          className="ally-lists__add-list"
          onClick={onAdd}
        >
          <span aria-hidden="true">+ </span>
          {t().tools.add}
        </Button>
      )}
    </div>
  );
};

/** The assistant's own tools (chunk 8a): what each does, and where it's changed. */
export const BuiltInPanel: React.FC<{
  tool: BuiltIn;
  bot: SectionProps["bot"];
  home: SectionProps["home"];
  canEdit: boolean;
  canManage: boolean;
  go: SectionProps["go"];
  /** Settings and Channels show one tool on its own, without the tab panel semantics. */
  standalone?: boolean;
}> = ({ tool, bot, home, canEdit, canManage, go, standalone = false }) => {
  const { data: how } = useGetHowItWorksQuery(bot.id);
  const name = tool.slice(1);
  return (
    <div
      id={`tool-panel-${name}`}
      role={standalone ? undefined : "tabpanel"}
      aria-labelledby={standalone ? undefined : `tool-tab-${name}`}
      className="ally-lists__panel ally-tools__panel"
      data-testid={`tool-${name}`}
    >
      {tool === "@pages" && (
        <div className="ally-card ally-tools__card">
          <h3 className="ally-home__group-title">{t().tools.pages}</h3>
          <p className="ally-small">{t().tools.pagesBody}</p>
          {how && (
            <p className="ally-body">{fill(t().tools.pagesCount, { n: how.search.documents })}</p>
          )}
          <div>
            <Button
              variant={ButtonVariant.TERTIARY}
              type="button"
              onClick={() => go("knowledge", "knows")}
            >
              {t().tools.pagesManage}
            </Button>
          </div>
        </div>
      )}
      {tool === "@memory" && (
        <>
          <MemorySettings botId={bot.id} home={home} canEdit={canEdit} />
          <div>
            <Button
              variant={ButtonVariant.TERTIARY}
              type="button"
              onClick={() => go("conversations")}
            >
              {t().tools.memoryInbox}
            </Button>
          </div>
        </>
      )}
      {tool === "@handover" && (
        <div className="ally-card ally-tools__card">
          <h3 className="ally-home__group-title">{t().tools.handover}</h3>
          <p className="ally-small">{t().tools.handoverBody}</p>
          <HandOverAbility botId={bot.id} canManage={canManage} />
          {!standalone && (
            <div>
              <Button variant={ButtonVariant.TERTIARY} type="button" onClick={() => go("settings")}>
                {t().tools.handoverChange}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/** A list's choices, always in view (chunk 8a): its services, classes or tables, with Edit. */
const Choices: React.FC<{ list: UserList; canEdit: boolean; onEdit: (field: string) => void }> = ({
  list,
  canEdit,
  onEdit,
}) => {
  const fields = liveFields(list).filter(
    f => f.type === "select" && f.key !== "status" && (f.options.values?.length ?? 0) > 0,
  );
  if (!fields.length) return null;
  return (
    <>
      {fields.map(field => (
        <div key={field.key} className="ally-card ally-tools__choices" data-testid="list-choices">
          <div className="ally-tools__choices-head">
            <h3 className="ally-home__group-title">
              {fill(t().choices.title, { detail: lower(field.label) })}
            </h3>
            {canEdit && (
              <Button
                variant={ButtonVariant.TERTIARY}
                type="button"
                onClick={() => onEdit(field.key)}
              >
                {t().choices.edit}
              </Button>
            )}
          </div>
          <p className="ally-small">{t().choices.hint}</p>
          <ul className="ally-tools__chips">
            {(field.options.values ?? []).map(value => (
              <li key={value} className="ally-tools__chip">
                {human(value)}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </>
  );
};

const OpenList: React.FC<{
  bot: SectionProps["bot"];
  list: UserList;
  lists: UserList[];
  canEdit: boolean;
  needsOptions: { field: string; label: string } | null;
  onDeleted: () => void;
}> = ({ bot, list, lists, canEdit, needsOptions, onDeleted }) => {
  const [focusDetail, setFocusDetail] = useState<string | null>(null);
  const details = liveFields(list);
  return (
    <div
      id={`list-panel-${list.key}`}
      role="tabpanel"
      aria-labelledby={`list-tab-${list.key}`}
      className="ally-lists__panel"
    >
      <div className="ally-tools__list-head">
        <h3 className="ally-heading">{list.name}</h3>
        {canEdit && <ListMenu botId={bot.id} list={list} lists={lists} onDeleted={onDeleted} />}
      </div>
      <Choices list={list} canEdit={canEdit} onEdit={setFocusDetail} />
      {needsOptions && canEdit && (
        <div className="ally-lists__notice" role="status">
          <p>{fill(t().table.replaceOptions, { detail: lower(needsOptions.label) })}</p>
          <Button
            variant={ButtonVariant.TERTIARY}
            type="button"
            onClick={() => setFocusDetail(needsOptions.field)}
          >
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
