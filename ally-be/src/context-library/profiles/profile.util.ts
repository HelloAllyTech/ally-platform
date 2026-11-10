import { ProfileChunkView } from './profile.types';

/** The first value of a facet, whether it is stored as one value or a list. */
export function firstFacet(chunk: ProfileChunkView, key: string): string {
  const value = chunk.facets?.[key];
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

export function joinList(values: readonly string[] | undefined): string {
  return (values ?? []).filter(Boolean).join('; ');
}

/** Facets flattened to "key:value" strings, the form the index filters on. */
export function facetValues(
  facets: Record<string, string | string[]>,
): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(facets ?? {})) {
    for (const v of Array.isArray(value) ? value : [value]) {
      if (v) out.push(`${key}:${v}`);
    }
  }
  return out;
}

/** Lower-kebab, for free-text topics and facets without a vocabulary. */
export function normaliseTag(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}
