import React, { useState } from "react";

import { toast } from "sonner";

import { SkeletonText } from "@ally-ui-mono/ui-shared";
import {
  useDeleteRoadmapIdeaDraftMutation,
  useGetRoadmapIdeaDraftsQuery,
  useUpdateRoadmapIdeaDraftMutation,
} from "@api";
import { ActionConfirmationPopup, Button, EmptyState } from "@components";
import { ButtonVariant } from "@components/types";
import { IDEA_DRAFT_TEXT_MAX, RoadmapIdeaDraft } from "@types";

interface IdeaDraftsTabProps {
  /** Start the guided interview from this draft. */
  onContinue: (draft: RoadmapIdeaDraft) => void;
}

const timeAgo = (iso: string): string => {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toISOString().slice(0, 10);
};

/**
 * My drafts — raw ideas saved from the mic-and-bulb button, private to their author.
 *
 * A draft is not an opportunity: it has no code, votes or rank and nobody else can see it.
 * Continuing one opens the normal copilot interview seeded with the raw words, and only filing
 * THAT creates the opportunity (and removes the draft). The server scopes every read and write
 * to the caller, so there is no manage tier here.
 */
export const IdeaDraftsTab: React.FC<IdeaDraftsTabProps> = ({ onContinue }) => {
  const { data, isLoading } = useGetRoadmapIdeaDraftsQuery();
  const [updateDraft, { isLoading: isUpdating }] = useUpdateRoadmapIdeaDraftMutation();
  const [deleteDraft, { isLoading: isDeleting }] = useDeleteRoadmapIdeaDraftMutation();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<RoadmapIdeaDraft | null>(null);

  const drafts = data?.items ?? [];

  const saveEdit = async (draft: RoadmapIdeaDraft) => {
    const rawText = editText.trim();
    if (!rawText) return;
    try {
      await updateDraft({ id: draft.id, body: { rawText } }).unwrap();
      setEditingId(null);
    } catch {
      toast.error("Could not save that change.");
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteDraft(deleteTarget.id).unwrap();
      setDeleteTarget(null);
      toast.success("Draft discarded.");
    } catch {
      toast.error("Could not discard that draft.");
    }
  };

  if (isLoading) return <SkeletonText paragraph lineCount={5} />;

  if (drafts.length === 0) {
    return (
      <EmptyState
        title="No saved ideas yet"
        subtitle="Tap the mic-and-bulb at the top right of any screen and say your idea out loud. It lands here, private, until you're ready to develop it."
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-typography-secondary text-xs">
        Private to you and unpublished. Continue a draft to have the copilot interview you; filing
        that interview is what creates the opportunity.
      </p>
      <ul className="flex flex-col gap-3">
        {drafts.map(draft => {
          const isEditing = editingId === draft.id;
          return (
            <li
              key={draft.id}
              className="border-border-light hover:border-primary-500/40 rounded-lg border p-3 transition-colors md:p-4"
            >
              <div className="text-typography-secondary mb-2 flex items-center gap-2 text-xs">
                <span aria-hidden="true">{draft.captureMode === "voice" ? "🎙" : "⌨"}</span>
                <span>{draft.captureMode === "voice" ? "Spoken" : "Typed"}</span>
                <span aria-hidden="true">·</span>
                <span>{timeAgo(draft.updatedAt)}</span>
                <span className="rounded-full bg-background-secondary px-2 py-0.5">Draft</span>
              </div>

              {isEditing ? (
                <textarea
                  value={editText}
                  onChange={event => setEditText(event.target.value.slice(0, IDEA_DRAFT_TEXT_MAX))}
                  rows={6}
                  aria-label="Edit draft"
                  className="border-border-light text-typography-primary w-full rounded border p-2 text-sm"
                />
              ) : (
                <p className="text-typography-primary text-sm whitespace-pre-wrap break-words line-clamp-6">
                  {draft.rawText}
                </p>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-1">
                {isEditing ? (
                  <>
                    <Button
                      variant={ButtonVariant.PRIMARY}
                      onClick={() => void saveEdit(draft)}
                      disabled={isUpdating || !editText.trim()}
                    >
                      Save
                    </Button>
                    <Button variant={ButtonVariant.TEXT} onClick={() => setEditingId(null)}>
                      Cancel
                    </Button>
                  </>
                ) : (
                  <>
                    <Button variant={ButtonVariant.PRIMARY} onClick={() => onContinue(draft)}>
                      Continue with copilot
                    </Button>
                    <Button
                      variant={ButtonVariant.TEXT}
                      onClick={() => {
                        setEditingId(draft.id);
                        setEditText(draft.rawText);
                      }}
                    >
                      Edit
                    </Button>
                    <Button variant={ButtonVariant.TEXT} onClick={() => setDeleteTarget(draft)}>
                      Discard
                    </Button>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <ActionConfirmationPopup
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Discard this draft"
        description="The saved idea is removed. This cannot be undone."
        primaryButton={{
          label: isDeleting ? "Discarding…" : "Discard",
          onClick: confirmDelete,
          variant: ButtonVariant.DESTRUCTIVE,
        }}
        secondaryButton={{
          label: "Cancel",
          onClick: () => setDeleteTarget(null),
          variant: ButtonVariant.SECONDARY,
        }}
      />
    </div>
  );
};
