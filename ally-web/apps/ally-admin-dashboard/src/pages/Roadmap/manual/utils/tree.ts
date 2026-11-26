import type { ManualPageRow } from "@types";

/**
 * The journey tree from `GET /tree`'s flat rows: sections → pages, each level ordered by
 * `position` then title. A row whose parent isn't in the list hangs at the top level, so nothing
 * the server sends is ever hidden by a dangling parent.
 */
export interface ManualTreeNode extends ManualPageRow {
  children: ManualTreeNode[];
  depth: number;
}

export interface ManualTreeFilters {
  role?: string | null;
  surface?: string | null;
}

const byPosition = (a: ManualPageRow, b: ManualPageRow): number =>
  a.position - b.position || a.title.localeCompare(b.title);

const matches = (row: ManualPageRow, filters: ManualTreeFilters): boolean =>
  (!filters.role || row.roles.includes(filters.role)) &&
  (!filters.surface || row.surfaces.includes(filters.surface));

export const hasFilters = (filters: ManualTreeFilters): boolean =>
  !!(filters.role || filters.surface);

export const buildTree = (
  rows: ManualPageRow[],
  filters: ManualTreeFilters = {},
): ManualTreeNode[] => {
  const known = new Set(rows.map(row => row.slug));
  const byParent = new Map<string | null, ManualPageRow[]>();
  for (const row of rows) {
    const parent = row.parentSlug && known.has(row.parentSlug) ? row.parentSlug : null;
    const list = byParent.get(parent) ?? [];
    list.push(row);
    byParent.set(parent, list);
  }
  const filtering = hasFilters(filters);
  const visit = (parent: string | null, depth: number, seen: Set<string>): ManualTreeNode[] =>
    (byParent.get(parent) ?? [])
      .slice()
      .sort(byPosition)
      .flatMap(row => {
        // A cycle in parentSlug would recurse forever; cut it.
        if (seen.has(row.slug)) return [];
        const next = new Set(seen).add(row.slug);
        const children = visit(row.slug, depth + 1, next);
        if (filtering) {
          // A section stays while anything under it matches; a page only when it matches itself.
          const keep = children.length > 0 || (row.kind === "page" && matches(row, filters));
          if (!keep) return [];
        }
        return [{ ...row, children, depth }];
      });
  return visit(null, 0, new Set());
};

/** Every role and surface tag in use, sorted, for the filter chips. */
export const collectFacets = (rows: ManualPageRow[]): { roles: string[]; surfaces: string[] } => {
  const roles = new Set<string>();
  const surfaces = new Set<string>();
  for (const row of rows) {
    row.roles.forEach(role => roles.add(role));
    row.surfaces.forEach(surface => surfaces.add(surface));
  }
  const sort = (set: Set<string>) => [...set].sort((a, b) => a.localeCompare(b));
  return { roles: sort(roles), surfaces: sort(surfaces) };
};

/**
 * The rows a keyboard walks, top to bottom, given which sections are open. A collapsed section's
 * children are skipped.
 */
export const flattenVisible = (
  nodes: ManualTreeNode[],
  isOpen: (slug: string) => boolean,
): ManualTreeNode[] =>
  nodes.flatMap(node => [
    node,
    ...(node.children.length && isOpen(node.slug) ? flattenVisible(node.children, isOpen) : []),
  ]);

/** The slugs from the top of the tree down to `slug`'s parent, so its section can be opened. */
export const ancestorsOf = (rows: ManualPageRow[], slug: string | null | undefined): string[] => {
  if (!slug) return [];
  const bySlug = new Map(rows.map(row => [row.slug, row]));
  const chain: string[] = [];
  let current = bySlug.get(slug)?.parentSlug ?? null;
  while (current && bySlug.has(current) && !chain.includes(current)) {
    chain.unshift(current);
    current = bySlug.get(current)?.parentSlug ?? null;
  }
  return chain;
};

/** Previous and next page among `slug`'s siblings in its section (pages only, tree order). */
export const siblingPager = (
  rows: ManualPageRow[],
  slug: string,
): { previous: ManualPageRow | null; next: ManualPageRow | null } => {
  const self = rows.find(row => row.slug === slug);
  if (!self) return { previous: null, next: null };
  const siblings = rows
    .filter(row => row.parentSlug === self.parentSlug && row.kind === "page")
    .sort(byPosition);
  const at = siblings.findIndex(row => row.slug === slug);
  if (at === -1) return { previous: null, next: null };
  return { previous: siblings[at - 1] ?? null, next: siblings[at + 1] ?? null };
};
