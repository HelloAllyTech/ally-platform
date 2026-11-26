import type { ManualGraph, ManualGraphNode } from "@types";

/**
 * The map's layout, kept out of the xyflow component so it can be tested and reused by the plain
 * list fallback: each top-level section is a box, every page under it is stacked inside (nested
 * sections flatten into their top-level one), and loose pages share an "Other" box at the end.
 * The boxes wrap into a grid about √n wide, so the whole manual is roughly square and `fitView`
 * lands at a zoom where titles can be read (one long row shrank everything to specks).
 */
export const MAP_COLUMN_WIDTH = 260;
export const MAP_COLUMN_GAP = 96;
export const MAP_ROW_GAP = 96;
export const MAP_ROW_HEIGHT = 44;
export const MAP_HEADER = 56;
export const MAP_PADDING_BOTTOM = 16;

export interface MapColumn {
  /** The top-level section's slug, or null for loose pages. */
  section: ManualGraphNode | null;
  pages: ManualGraphNode[];
}

export const mapColumns = (graph: ManualGraph): MapColumn[] => {
  const bySlug = new Map(graph.nodes.map(node => [node.slug, node]));
  const topOf = (node: ManualGraphNode): ManualGraphNode | null => {
    let current: ManualGraphNode | undefined = node;
    const seen = new Set<string>();
    while (current?.parentSlug && bySlug.has(current.parentSlug) && !seen.has(current.slug)) {
      seen.add(current.slug);
      current = bySlug.get(current.parentSlug);
    }
    return current && current.slug !== node.slug && current.kind === "section" ? current : null;
  };
  const sections = graph.nodes.filter(
    node => node.kind === "section" && (!node.parentSlug || !bySlug.has(node.parentSlug)),
  );
  const columns = new Map<string | null, MapColumn>(
    sections.map(section => [section.slug, { section, pages: [] }]),
  );
  const loose: MapColumn = { section: null, pages: [] };
  for (const node of graph.nodes) {
    if (node.kind === "section" && columns.has(node.slug)) continue;
    const top = topOf(node);
    const column = top ? columns.get(top.slug) : undefined;
    (column ?? loose).pages.push(node);
  }
  const list = [...columns.values()];
  return loose.pages.length ? [...list, loose] : list;
};

/** Slugs joined to `slug` by an edge either way, plus `slug` itself. */
export const neighboursOf = (graph: ManualGraph, slug: string | null): Set<string> => {
  const set = new Set<string>();
  if (!slug) return set;
  set.add(slug);
  for (const edge of graph.edges) {
    if (edge.from === slug) set.add(edge.to);
    if (edge.to === slug) set.add(edge.from);
  }
  return set;
};

export interface MapBox {
  column: MapColumn;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The height of one section's box: its title band plus its stacked pages. */
export const boxHeight = (pageCount: number): number =>
  MAP_HEADER + pageCount * MAP_ROW_HEIGHT + MAP_PADDING_BOTTOM;

/**
 * Places the section boxes in a wrapped grid of ceil(√n) columns. Each grid row is as tall as its
 * tallest box, so boxes in a row line up at the top and rows never overlap.
 */
export const mapGrid = (columns: MapColumn[]): { boxes: MapBox[]; perRow: number } => {
  const perRow = Math.max(1, Math.ceil(Math.sqrt(columns.length)));
  const boxes: MapBox[] = [];
  let y = 0;
  for (let start = 0; start < columns.length; start += perRow) {
    const row = columns.slice(start, start + perRow);
    const rowHeight = Math.max(...row.map(column => boxHeight(column.pages.length)));
    row.forEach((column, index) => {
      boxes.push({
        column,
        x: index * (MAP_COLUMN_WIDTH + MAP_COLUMN_GAP),
        y,
        width: MAP_COLUMN_WIDTH,
        height: boxHeight(column.pages.length),
      });
    });
    y += rowHeight + MAP_ROW_GAP;
  }
  return { boxes, perRow };
};
