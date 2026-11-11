import { ClCollectionId } from '../enum/context-library.enum';
import { ALLY_GUIDE_LIBRARY_PROFILE } from './ally-guide-library.profile';
import { BUG_HUNTER_NOTES_PROFILE } from './bug-hunter-notes.profile';
import { BUILDER_LESSONS_PROFILE } from './builder-lessons.profile';
import { CHARACTER_INSIGHTS_PROFILE } from './character-insights.profile';
import { CONTENT_CATALOGUE_PROFILE } from './content-catalogue.profile';
import { DEBRIEF_GUIDANCE_PROFILE } from './debrief-guidance.profile';
import { FIRST_PRINCIPLES_PROFILE } from './first-principles.profile';
import { LEARNING_DESIGN_PROFILE } from './learning-design.profile';
import { PRODUCT_OUTCOMES_PROFILE } from './product-outcomes.profile';
import { CollectionProfile } from './profile.types';

export * from './critic-checks';
export * from './profile.types';
export * from './profile.util';

/**
 * Every collection the engine knows how to handle. A collection without a profile here
 * cannot be written to or searched, whatever `cl_collections` says.
 */
export const COLLECTION_PROFILES: Partial<
  Record<ClCollectionId, CollectionProfile>
> = {
  [ClCollectionId.FIRST_PRINCIPLES]: FIRST_PRINCIPLES_PROFILE,
  [ClCollectionId.CHARACTER_INSIGHTS]: CHARACTER_INSIGHTS_PROFILE,
  [ClCollectionId.BUILDER_LESSONS]: BUILDER_LESSONS_PROFILE,
  [ClCollectionId.BUG_HUNTER_NOTES]: BUG_HUNTER_NOTES_PROFILE,
  [ClCollectionId.ALLY_GUIDE_LIBRARY]: ALLY_GUIDE_LIBRARY_PROFILE,
  [ClCollectionId.DEBRIEF_GUIDANCE]: DEBRIEF_GUIDANCE_PROFILE,
  [ClCollectionId.LEARNING_DESIGN]: LEARNING_DESIGN_PROFILE,
  [ClCollectionId.CONTENT_CATALOGUE]: CONTENT_CATALOGUE_PROFILE,
  [ClCollectionId.PRODUCT_OUTCOMES]: PRODUCT_OUTCOMES_PROFILE,
};

export function getProfile(
  collectionId: string,
): CollectionProfile | undefined {
  return COLLECTION_PROFILES[collectionId as ClCollectionId];
}

export function requireProfile(collectionId: string): CollectionProfile {
  const profile = getProfile(collectionId);
  if (!profile) {
    throw new Error(
      `No Context Library profile for collection "${collectionId}"`,
    );
  }
  return profile;
}

/** The Weaviate collection that holds one collection's chunks at one index version. */
export function indexCollectionName(
  collectionId: string,
  version: number,
): string {
  const pascal = collectionId
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
  return `Ctx${pascal}_v${version}`;
}
