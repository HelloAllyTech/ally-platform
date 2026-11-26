import React, { useState } from "react";

import { Link } from "react-router-dom";
import { toast } from "sonner";

import {
  Button,
  Modal,
  OverflowMenu,
  OverflowMenuItem,
  SidePanel,
  SkeletonText,
  Tag,
} from "@ally-ui-mono/ui-shared";
import { useGetManualChangesQuery, useRevertManualPageMutation } from "@api";
import { en } from "@constants";
import type { ManualChangeRow } from "@types";
import { formatDate, formatRelativeTime } from "@utils";

import { manualHref } from "../utils/wikilinks";

const ChangeList: React.FC<{
  slug?: string;
  onRestore?: (change: ManualChangeRow) => void;
}> = ({ slug, onRestore }) => {
  const copy = en.productManual.changes;
  const { data, isLoading, isError, refetch } = useGetManualChangesQuery({ slug, limit: 30 });
  if (isLoading) return <SkeletonText paragraph lineCount={6} />;
  if (isError) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="m-0 text-sm text-typography-800">{copy.loadFailed}</p>
        <Button kind="tertiary" size="sm" onClick={() => refetch()}>
          {en.productManual.retry}
        </Button>
      </div>
    );
  }
  const changes = data ?? [];
  if (changes.length === 0) return <p className="m-0 text-sm text-typography-600">{copy.empty}</p>;
  return (
    <ol className="m-0 flex list-none flex-col p-0">
      {changes.map((change, index) => (
        <li
          key={change.id}
          className="flex items-start gap-3 border-b border-border-light py-3 last:border-b-0"
        >
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            {!slug && (
              <Link
                to={manualHref(change.slug)}
                className="text-sm font-semibold text-typography-900 hover:underline"
              >
                {change.pageTitle}
              </Link>
            )}
            <p className="m-0 text-sm text-typography-800">{change.reason || copy.noReason}</p>
            <p className="m-0 flex flex-wrap items-center gap-2 text-xs text-typography-600">
              <span title={formatDate(change.at)}>{formatRelativeTime(change.at)}</span>
              <span aria-hidden>·</span>
              <span>{change.authorLabel}</span>
              {change.revertOf && (
                <Tag type="purple" size="sm" className="!m-0">
                  {copy.reverted}
                </Tag>
              )}
              {slug && index === 0 && (
                <Tag type="gray" size="sm" className="!m-0">
                  {copy.current}
                </Tag>
              )}
            </p>
          </div>
          {onRestore && slug && index > 0 && (
            <OverflowMenu
              aria-label={copy.actions}
              iconDescription={copy.actions}
              flipped
              size="sm"
            >
              <OverflowMenuItem itemText={copy.restore} onClick={() => onRestore(change)} />
            </OverflowMenu>
          )}
        </li>
      ))}
    </ol>
  );
};

/**
 * What changed: one page's revisions (with Restore this version), or — with no slug — the recent
 * changes across the whole manual. Authors are named by `authorLabel`; a revert says so.
 */
export const ChangeLogPanel: React.FC<{
  open: boolean;
  slug?: string | null;
  pageTitle?: string | null;
  onClose: () => void;
}> = ({ open, slug, pageTitle, onClose }) => {
  const copy = en.productManual.changes;
  const [restoring, setRestoring] = useState<ManualChangeRow | null>(null);
  const [revert, { isLoading }] = useRevertManualPageMutation();

  const restore = async () => {
    if (!restoring || !slug) return;
    try {
      await revert({ slug, revisionId: restoring.id }).unwrap();
      toast.success(copy.restored);
    } catch {
      toast.error(copy.restoreFailed);
    } finally {
      setRestoring(null);
    }
  };

  return (
    <>
      <SidePanel
        open={open}
        onClose={onClose}
        side="right"
        width="28rem"
        closeLabel={copy.close}
        title={slug ? copy.title(pageTitle ?? slug) : copy.recentTitle}
      >
        <div className="ally-v2 px-1">
          {open && (
            <ChangeList key={slug ?? "all"} slug={slug ?? undefined} onRestore={setRestoring} />
          )}
        </div>
      </SidePanel>
      <Modal
        open={!!restoring}
        size="xs"
        modalHeading={copy.confirmTitle}
        primaryButtonText={copy.confirm}
        secondaryButtonText={copy.cancel}
        primaryButtonDisabled={isLoading}
        onRequestClose={() => setRestoring(null)}
        onRequestSubmit={restore}
      >
        <p className="text-sm text-typography-800">
          {restoring ? copy.confirmBody(formatRelativeTime(restoring.at)) : ""}
        </p>
      </Modal>
    </>
  );
};
