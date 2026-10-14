import React, { useState } from "react";

import { toast } from "sonner";

import { IconButton, InlineNotification } from "@ally-ui-mono/ui-shared";
import {
  PublicRoadmapCategory,
  PublicRoadmapItem,
  PublicRoadmapStage,
  useDeletePublicRoadmapItemMutation,
  useGetPublicRoadmapItemsQuery,
  useReorderPublicRoadmapItemsMutation,
  useUpdatePublicRoadmapItemMutation,
} from "@api";
import { Add, ArrowDown, ArrowUp, Edit, Launch, Trash } from "@assets";
import { ActionConfirmationPopup, Button } from "@components";
import { buildPublicLink } from "@components/organization-access-details/text-helpline/helpers";
import { ButtonVariant } from "@components/types";
import { en } from "@constants";

import {
  ROADMAP_CATEGORIES,
  ROADMAP_PUBLIC_PATH,
  ROADMAP_STAGES,
  groupRoadmapItems,
  reorderedIds,
} from "./roadmap";
import { RoadmapCardPanel } from "./RoadmapCardPanel";

const strings = en.settings.roadmap;

const withTitle = (template: string, title: string) => template.replace("{title}", title);

type PanelState = {
  open: boolean;
  item: PublicRoadmapItem | null;
  defaults: { category: PublicRoadmapCategory; stage: PublicRoadmapStage };
};

const CLOSED_PANEL: PanelState = {
  open: false,
  item: null,
  defaults: { category: ROADMAP_CATEGORIES[0], stage: ROADMAP_STAGES[0] },
};

const CardRow: React.FC<{
  item: PublicRoadmapItem;
  isFirst: boolean;
  isLast: boolean;
  busy: boolean;
  onMove: (direction: -1 | 1) => void;
  onToggleVisible: () => void;
  onEdit: () => void;
  onDelete: () => void;
}> = ({ item, isFirst, isLast, busy, onMove, onToggleVisible, onEdit, onDelete }) => (
  <li className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
    <div className={`min-w-0 ${item.isPublic ? "" : "opacity-60"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-base text-typography-900">{item.title}</span>
        {!item.isPublic && (
          <span className="rounded-sm bg-neutral-100 px-1.5 py-0.5 text-xs text-typography-600">
            {strings.hidden}
          </span>
        )}
      </div>
      <p className="mt-0.5 text-sm text-typography-600">{item.description}</p>
      {item.note && <p className="mt-1 text-xs italic text-[#B34F2C]">{item.note}</p>}
    </div>

    <div className="flex shrink-0 items-center gap-1">
      <Button
        variant={ButtonVariant.TEXT}
        onClick={onToggleVisible}
        disabled={busy}
        aria-label={withTitle(item.isPublic ? strings.hideLabel : strings.showLabel, item.title)}
      >
        {item.isPublic ? strings.hide : strings.show}
      </Button>
      <IconButton
        kind="ghost"
        size="sm"
        label={withTitle(strings.moveUp, item.title)}
        disabled={busy || isFirst}
        onClick={() => onMove(-1)}
      >
        <ArrowUp width={16} height={16} />
      </IconButton>
      <IconButton
        kind="ghost"
        size="sm"
        label={withTitle(strings.moveDown, item.title)}
        disabled={busy || isLast}
        onClick={() => onMove(1)}
      >
        <ArrowDown width={16} height={16} />
      </IconButton>
      <IconButton
        kind="ghost"
        size="sm"
        label={withTitle(strings.edit, item.title)}
        onClick={onEdit}
      >
        <Edit width={16} height={16} />
      </IconButton>
      <IconButton
        kind="ghost"
        size="sm"
        label={withTitle(strings.delete, item.title)}
        disabled={busy}
        onClick={onDelete}
      >
        <Trash width={16} height={16} />
      </IconButton>
    </div>
  </li>
);

/**
 * Settings → Roadmap: the cards on the public product roadmap, laid out the way
 * the page groups them (category, then stage) so an editor sees where a card
 * will land. Every action is live — there is no draft — which is why "Hide" sits
 * on each row as the reversible way to take a card down.
 */
export const RoadmapTab: React.FC = () => {
  const { data: items = [], isLoading, isError } = useGetPublicRoadmapItemsQuery();
  const [updateItem, { isLoading: isUpdating }] = useUpdatePublicRoadmapItemMutation();
  const [reorderItems, { isLoading: isReordering }] = useReorderPublicRoadmapItemsMutation();
  const [deleteItem, { isLoading: isDeleting }] = useDeletePublicRoadmapItemMutation();
  const busy = isUpdating || isReordering || isDeleting;

  const [panel, setPanel] = useState<PanelState>(CLOSED_PANEL);
  const [pendingDelete, setPendingDelete] = useState<PublicRoadmapItem | null>(null);

  const cells = groupRoadmapItems(items);

  const openNew = (category: PublicRoadmapCategory, stage: PublicRoadmapStage) =>
    setPanel({ open: true, item: null, defaults: { category, stage } });

  const move = async (cell: PublicRoadmapItem[], item: PublicRoadmapItem, direction: -1 | 1) => {
    const ids = reorderedIds(cell, item.id, direction);
    if (!ids) return;
    try {
      await reorderItems(ids).unwrap();
    } catch {
      toast.error(strings.moveFailed);
    }
  };

  const toggleVisible = async (item: PublicRoadmapItem) => {
    try {
      await updateItem({ id: item.id, isPublic: !item.isPublic }).unwrap();
    } catch {
      toast.error(strings.visibilityFailed);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const { id } = pendingDelete;
    setPendingDelete(null);
    try {
      await deleteItem(id).unwrap();
      toast.success(strings.deleted);
    } catch {
      toast.error(strings.deleteFailed);
    }
  };

  return (
    <section className="flex max-w-4xl flex-col gap-6">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <Button
          variant={ButtonVariant.PRIMARY}
          onClick={() => openNew(ROADMAP_CATEGORIES[0], ROADMAP_STAGES[0])}
          disabled={isLoading || isError}
        >
          {strings.addCard}
        </Button>
        <a
          href={buildPublicLink(ROADMAP_PUBLIC_PATH)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-10 items-center gap-1.5 text-sm text-primary-600 hover:underline md:min-h-0"
        >
          {strings.viewPublicPage}
          <Launch width={14} height={14} aria-hidden="true" />
        </a>
      </div>

      {isLoading ? (
        <p className="text-sm text-typography-600">{en.common.loading}</p>
      ) : isError ? (
        <InlineNotification kind="error" lowContrast hideCloseButton title={strings.loadFailed} />
      ) : (
        ROADMAP_CATEGORIES.map(category => (
          <div key={category} className="flex flex-col gap-4">
            <h2 className="font-secondary text-xl text-typography-900">
              {strings.categories[category]}
            </h2>
            {ROADMAP_STAGES.map(stage => {
              const cell = cells[category][stage];
              const addLabel = strings.addToStage
                .replace("{category}", strings.categories[category])
                .replace("{stage}", strings.stages[stage]);
              return (
                <div key={stage} className="rounded-md border border-border-light bg-white">
                  <div className="flex items-center justify-between border-b border-border-light px-4 py-2">
                    <h3 className="text-sm font-medium text-typography-800">
                      {strings.stages[stage]}
                      <span className="ml-2 font-normal text-typography-400">{cell.length}</span>
                    </h3>
                    <IconButton
                      kind="ghost"
                      size="sm"
                      label={addLabel}
                      onClick={() => openNew(category, stage)}
                    >
                      <Add width={16} height={16} />
                    </IconButton>
                  </div>
                  {cell.length === 0 ? (
                    <p className="px-4 py-3 text-sm text-typography-400">{strings.emptyStage}</p>
                  ) : (
                    <ul className="divide-y divide-border-light">
                      {cell.map((item, index) => (
                        <CardRow
                          key={item.id}
                          item={item}
                          isFirst={index === 0}
                          isLast={index === cell.length - 1}
                          busy={busy}
                          onMove={direction => void move(cell, item, direction)}
                          onToggleVisible={() => void toggleVisible(item)}
                          onEdit={() =>
                            setPanel({ open: true, item, defaults: { category, stage } })
                          }
                          onDelete={() => setPendingDelete(item)}
                        />
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        ))
      )}

      <RoadmapCardPanel
        isOpen={panel.open}
        item={panel.item}
        defaults={panel.defaults}
        onClose={() => setPanel(CLOSED_PANEL)}
      />

      <ActionConfirmationPopup
        isOpen={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title={strings.deleteTitle}
        description={withTitle(
          pendingDelete?.isPublic === false
            ? strings.deleteHiddenDescription
            : strings.deleteDescription,
          pendingDelete?.title ?? "",
        )}
        primaryButton={{
          label: strings.deleteConfirm,
          onClick: () => void confirmDelete(),
          variant: ButtonVariant.DESTRUCTIVE,
        }}
        secondaryButton={{ label: en.common.cancel, onClick: () => setPendingDelete(null) }}
      />
    </section>
  );
};
