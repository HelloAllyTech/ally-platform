import React from "react";

import { Library } from "lucide-react";
import { Link } from "react-router-dom";

import { useGetContextCollectionsQuery } from "@api";
import { FeatureToggleKey, Permissions, ROUTES } from "@constants";
import { useUser } from "@hooks";
import { hasFeature, hasPermissions } from "@utils";

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
}

/**
 * A product's one-line summary of a Context Library collection it reads, linking to where that
 * collection is managed (docs/context-library/PLAN.md §10.2: "Builder room header → Builder
 * Lessons", "Bug Hunter → its Notes"). It replaces the product's own copy of the list, so there is
 * one place to add, edit, pin or archive entries rather than two. The same shape as the Character
 * Library's `CharacterInsightsCard`.
 *
 * Shown only to people the Context Library itself admits (its feature toggle and view permission,
 * the pair the collections endpoint enforces): a link to a page that turns them away would be a
 * dead end. The count is a convenience from the collections list the Context Library already
 * loads, so while it is loading, or if it fails, the card is simply the link.
 */
export const ContextCollectionLink: React.FC<ContextCollectionLinkProps> = ({
  collection: collectionId,
  copy,
}) => {
  const { permissions, features } = useUser();
  const canOpen =
    hasFeature(features, FeatureToggleKey.CONTEXT_LIBRARY) &&
    hasPermissions(permissions, [Permissions.VIEW_CONTEXT_LIBRARY]);

  const { data: collections } = useGetContextCollectionsQuery(undefined, { skip: !canOpen });

  if (!canOpen) return null;

  // Built here rather than at module load: tests mock `@constants` wholesale.
  const href = `${ROUTES.CONTEXT_LIBRARY}?collection=${collectionId}`;

  // A status missing from `counts` is zero, so a listed collection always has a count.
  const collection = collections?.find(c => c.id === collectionId);
  const count = collection ? copy.count(collection.counts?.active ?? 0) : null;

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
