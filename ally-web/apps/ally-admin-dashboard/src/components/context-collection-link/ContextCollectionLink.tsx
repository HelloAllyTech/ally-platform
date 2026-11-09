import React from "react";

import { Library } from "lucide-react";
import { Link } from "react-router-dom";

import { useGetContextCollectionsQuery } from "@api";
import { ROUTES } from "@constants";
import { useUser } from "@hooks";
import { deriveContextLibraryAccess } from "@pages/ContextLibrary/contextLibraryScope";

/** What one product calls its collection, in its own words. */
export interface ContextCollectionLinkCopy {
  title: string;
  description: string;
  count: (n: number) => string;
  manage: string;
  manageLabel: string;
}

interface ContextCollectionLinkProps {
  /** The Context Library collection id, e.g. `builder_lessons`. */
  collection: string;
  copy: ContextCollectionLinkCopy;
  /**
   * One organisation the link is about (an organisation's Ally tab). A platform admin lands on the
   * collection filtered to entries reaching it; that organisation's own admin lands on its own
   * view, with its own entries counted.
   */
  tenantId?: string;
}

/**
 * A product's one-line summary of a Context Library collection it reads, linking to where that
 * collection is managed (docs/context-library/PLAN.md §10.2: "Builder room header → Builder
 * Lessons", "Bug Hunter → its Notes"). It replaces the product's own copy of the list, so there is
 * one place to add, edit, pin or archive entries rather than two. The same shape as the Character
 * Library's `CharacterInsightsCard`.
 *
 * Shown only to people the Context Library itself admits (§10.2: a platform admin, or — for one
 * organisation — that organisation's admin): a link to a page that turns them away would be a
 * dead end. The count is a convenience from the collections list the Context Library already
 * loads, so while it is loading, or if it fails, the card is simply the link.
 */
export const ContextCollectionLink: React.FC<ContextCollectionLinkProps> = ({
  collection: collectionId,
  copy,
  tenantId,
}) => {
  const { permissions, features, user } = useUser();
  const access = deriveContextLibraryAccess(
    permissions,
    features,
    user?.restrictedTenantIds ?? null,
  );
  const asOrg = access.mode === "organisation" && Boolean(tenantId);
  const canOpen = access.mode === "platform" || asOrg;

  const { data: collections } = useGetContextCollectionsQuery(asOrg ? { tenantId } : undefined, {
    skip: !canOpen,
  });

  if (!canOpen) return null;

  // Built here rather than at module load: tests mock `@constants` wholesale.
  const params = new URLSearchParams({ collection: collectionId });
  if (tenantId) params.set(asOrg ? "org" : "audience", tenantId);
  const href = `${ROUTES.CONTEXT_LIBRARY}?${params.toString()}`;

  // A status missing from `counts` is zero, so a listed collection always has a count. An
  // organisation's admin counts their own entries.
  const collection = collections?.find(c => c.id === collectionId);
  const count = collection
    ? copy.count(asOrg ? (collection.ownActive ?? 0) : (collection.counts?.active ?? 0))
    : null;

  return (
    <section
      aria-label={copy.title}
      data-testid={`context-collection-link-${collectionId}`}
      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm"
    >
      <Library className="h-4 w-4 shrink-0 text-typography-600" aria-hidden />
      <div className="min-w-0">
        <span className="font-medium text-typography-900">{copy.title}</span>
        {count && (
          <span className="text-typography-600" data-testid="context-collection-count">
            {" "}
            · {count}
          </span>
        )}
        <span className="text-typography-600"> — {copy.description}</span>
      </div>
      <Link
        to={href}
        aria-label={copy.manageLabel}
        className="inline-flex items-center gap-1 text-primary-600 hover:text-primary-700 max-md:min-h-10"
      >
        {copy.manage}
        <span aria-hidden>→</span>
      </Link>
    </section>
  );
};
