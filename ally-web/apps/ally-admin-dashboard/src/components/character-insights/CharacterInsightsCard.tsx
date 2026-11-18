import React from "react";

import { Library } from "lucide-react";
import { Link } from "react-router-dom";

import { useGetContextCollectionsQuery } from "@api";
import { FeatureToggleKey, Permissions, ROUTES, en } from "@constants";
import { useUser } from "@hooks";
import { hasFeature, hasPermissions } from "@utils";

/** The Context Library collection the character interview's `search_corpus` reads. */
export const CHARACTER_INSIGHTS_COLLECTION = "character_insights";

interface CharacterInsightsCardProps {
  /** One link for a crowded header (the interview page); the full card everywhere else. */
  compact?: boolean;
}

/**
 * The Character Library's summary of what the character interview draws on, linking to where it
 * is managed: the Context Library's Character Insights collection (docs/context-library/PLAN.md
 * §10.2). It replaced the in-page reference-corpus panel, so there is one place to curate the
 * material rather than two.
 *
 * Shown only to people the Context Library itself admits (its feature toggle and view
 * permission, the same pair the collections endpoint enforces). Trainers and organisation
 * admins use this page too, and a link to a page that turns them away would be a dead end.
 *
 * The count is a convenience from the collections list the Context Library already loads, so
 * while it is loading or if it fails the card is simply the link.
 */
export const CharacterInsightsCard: React.FC<CharacterInsightsCardProps> = ({ compact }) => {
  const strings = en.characterInsights;
  const { permissions, features } = useUser();
  const canOpen =
    hasFeature(features, FeatureToggleKey.CONTEXT_LIBRARY) &&
    hasPermissions(permissions, [Permissions.VIEW_CONTEXT_LIBRARY]);

  const { data: collections } = useGetContextCollectionsQuery(undefined, { skip: !canOpen });

  if (!canOpen) return null;

  // Built here rather than at module load: tests mock `@constants` wholesale.
  const href = `${ROUTES.CONTEXT_LIBRARY}?collection=${CHARACTER_INSIGHTS_COLLECTION}`;

  // A status missing from `counts` is zero, so a listed collection always has a count.
  const collection = collections?.find(c => c.id === CHARACTER_INSIGHTS_COLLECTION);
  const count = collection ? strings.count(collection.counts?.active ?? 0) : null;

  if (compact) {
    return (
      <Link
        to={href}
        aria-label={strings.manageLabel}
        title={strings.manageLabel}
        data-testid="character-insights-link"
        className="inline-flex items-center gap-1.5 text-sm text-primary-600 hover:text-primary-700 max-md:min-h-10"
      >
        <Library className="h-4 w-4 shrink-0" aria-hidden />
        <span>{strings.title}</span>
        {count && (
          <span className="text-typography-500" data-testid="character-insights-count">
            · {count}
          </span>
        )}
      </Link>
    );
  }

  return (
    <section
      aria-label={strings.title}
      data-testid="character-insights-card"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm"
    >
      <Library className="h-4 w-4 shrink-0 text-typography-600" aria-hidden />
      <div className="min-w-0">
        <span className="font-medium text-typography-900">{strings.title}</span>
        {count && (
          <span className="text-typography-600" data-testid="character-insights-count">
            {" "}
            · {count}
          </span>
        )}
        <span className="text-typography-600"> — {strings.description}</span>
      </div>
      <Link
        to={href}
        aria-label={strings.manageLabel}
        data-testid="character-insights-link"
        className="inline-flex items-center gap-1 text-primary-600 hover:text-primary-700 max-md:min-h-10"
      >
        {strings.manage}
        <span aria-hidden>→</span>
      </Link>
    </section>
  );
};
