import React, { useMemo, useState } from "react";

import {
  Background,
  Controls,
  Edge,
  Handle,
  MarkerType,
  Node,
  NodeProps,
  Position,
  ReactFlow,
  ReactFlowProvider,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { en } from "@constants";
import type { ManualGraph } from "@types";

import { useReducedMotionPreference } from "../../../../motion";
import { MAP_HEADER, MAP_ROW_HEIGHT, mapColumns, mapGrid, neighboursOf } from "../utils/mapLayout";

/** Carbon white-theme values for the canvas, which styles nodes inline rather than by class. */
const INK = "var(--ally-ink, #161616)";
const LINE = "var(--ally-line, #e0e0e0)";
const ACCENT = "var(--ally-accent, #0f62fe)";
const OTHER_ID = "__other";

type LabelData = {
  label: string;
  dimmed?: boolean;
  lit?: boolean;
  current?: boolean;
  /** Reduced motion: no fades. */
  still?: boolean;
};

const fade = (still?: boolean) => (still ? "none" : "opacity 150ms cubic-bezier(0.2,0,0.38,0.9)");

/** A section's box: its title in larger type at the top; its pages sit inside it. */
const SectionNode: React.FC<NodeProps<Node<LabelData>>> = ({ data }) => (
  <div
    className="h-full w-full border px-3 py-3"
    style={{
      borderColor: data.lit ? ACCENT : LINE,
      background: "var(--ally-surface-2, #f4f4f4)",
      opacity: data.dimmed ? 0.35 : 1,
      transition: fade(data.still),
    }}
  >
    <span className="block truncate text-base font-semibold leading-tight" style={{ color: INK }}>
      {data.label}
    </span>
  </div>
);

/** A page: one line, its links' ends kept invisible so the box stays calm. */
const PageNode: React.FC<NodeProps<Node<LabelData>>> = ({ data }) => (
  <div
    className="flex h-full w-full items-center border bg-white px-2 text-xs"
    style={{
      color: INK,
      borderColor: data.current || data.lit ? ACCENT : LINE,
      borderWidth: data.current ? 2 : 1,
      opacity: data.dimmed ? 0.25 : 1,
      transition: fade(data.still),
    }}
  >
    <Handle type="target" position={Position.Left} style={{ opacity: 0, border: 0 }} />
    <span className="truncate">{data.label}</span>
    <Handle type="source" position={Position.Right} style={{ opacity: 0, border: 0 }} />
  </div>
);

// Defined once, outside the component: xyflow warns (and re-mounts nodes) when this changes.
const NODE_TYPES = { section: SectionNode, page: PageNode };

export interface MapViewProps {
  graph: ManualGraph;
  currentSlug?: string | null;
  onOpen: (slug: string) => void;
}

/** The slug of the map node an event came from, or null for a section or the background. */
const pageIdOf = (target: EventTarget | null): string | null => {
  const element = (target as HTMLElement | null)?.closest?.(".react-flow__node-page");
  return element?.getAttribute("data-id") ?? null;
};

/**
 * The manual as a map: sections as boxes in a wrapped grid, pages stacked inside them, links as
 * edges. Edges are faint until you hover or focus a page; then its links draw bold and its
 * neighbours light up while the rest dims. Clicking (or Enter on a focused page) opens it. Zoom
 * and pan come from the canvas; `fitView` frames the manual on open. Under reduced motion nothing
 * animates (no animated edges, no eased fit, no fades).
 *
 * Loaded lazily — xyflow stays out of the reader's chunk.
 */
const MapCanvas: React.FC<MapViewProps> = ({ graph, currentSlug, onOpen }) => {
  const copy = en.productManual.mapView;
  const reduced = useReducedMotionPreference();
  const [hovered, setHovered] = useState<string | null>(null);
  const lit = useMemo(() => neighboursOf(graph, hovered), [graph, hovered]);

  const { nodes, edges } = useMemo(() => {
    const dim = (slug: string) => hovered !== null && !lit.has(slug);
    const { boxes } = mapGrid(mapColumns(graph));
    const placed: Node<LabelData>[] = [];
    const known = new Set<string>();
    for (const box of boxes) {
      const section = box.column.section;
      const groupId = section?.slug ?? OTHER_ID;
      const sectionLit = !!section && hovered !== null && lit.has(section.slug);
      placed.push({
        id: groupId,
        type: "section",
        position: { x: box.x, y: box.y },
        data: {
          label: section?.title ?? copy.other,
          dimmed: hovered !== null && !box.column.pages.some(page => lit.has(page.slug)),
          lit: sectionLit,
          still: reduced,
        },
        style: { width: box.width, height: box.height },
        draggable: false,
        selectable: false,
        focusable: false,
      });
      if (section) known.add(section.slug);
      box.column.pages.forEach((page, row) => {
        known.add(page.slug);
        placed.push({
          id: page.slug,
          type: "page",
          parentId: groupId,
          extent: "parent",
          position: { x: 12, y: MAP_HEADER + row * MAP_ROW_HEIGHT },
          data: {
            label: page.title,
            dimmed: dim(page.slug),
            lit: hovered === page.slug,
            current: page.slug === currentSlug,
            still: reduced,
          },
          style: { width: box.width - 24, height: MAP_ROW_HEIGHT - 12 },
          draggable: false,
          ariaLabel: page.title,
        });
      });
    }
    const lines: Edge[] = graph.edges
      .filter(edge => known.has(edge.from) && known.has(edge.to) && edge.from !== edge.to)
      .map(edge => {
        const on = hovered !== null && (edge.from === hovered || edge.to === hovered);
        return {
          id: `${edge.from}->${edge.to}`,
          source: edge.from,
          target: edge.to,
          animated: false,
          focusable: false,
          zIndex: on ? 10 : 0,
          markerEnd: on
            ? { type: MarkerType.ArrowClosed, width: 14, height: 14, color: ACCENT }
            : undefined,
          style: {
            stroke: on ? ACCENT : "var(--ally-line-strong, #c6c6c6)",
            strokeWidth: on ? 2 : 1,
            // Faint by default: with every link drawn at once they merge into a grey smear.
            opacity: hovered === null ? 0.12 : on ? 1 : 0.04,
          },
        };
      });
    return { nodes: placed, edges: lines };
  }, [graph, currentSlug, hovered, lit, reduced, copy.other]);

  return (
    <div
      className="relative h-full min-h-[24rem] w-full"
      aria-label={copy.label}
      role="region"
      onFocusCapture={event => {
        const id = pageIdOf(event.target);
        if (id) setHovered(id);
      }}
      onBlurCapture={() => setHovered(null)}
      onKeyDownCapture={event => {
        const id = pageIdOf(event.target);
        if (id && event.key === "Enter") {
          event.preventDefault();
          onOpen(id);
        }
      }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        fitView
        fitViewOptions={{ padding: 0.08, minZoom: 0.15, maxZoom: 1.4, duration: reduced ? 0 : 280 }}
        minZoom={0.15}
        maxZoom={1.4}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        proOptions={{ hideAttribution: true }}
        onNodeMouseEnter={(_event, node) => node.type === "page" && setHovered(node.id)}
        onNodeMouseLeave={() => setHovered(null)}
        onNodeClick={(_event, node) => {
          if (node.type === "page" || (node.type === "section" && node.id !== OTHER_ID)) {
            onOpen(node.id);
          }
        }}
      >
        <Background gap={24} size={1} color="#e0e0e0" />
        <Controls showInteractive={false} />
      </ReactFlow>
      <div
        aria-label={copy.legend}
        className="absolute bottom-3 right-3 flex items-center gap-3 border border-border-light bg-white px-3 py-1.5 text-xs text-typography-700"
      >
        <span className="flex items-center gap-1">
          <span className="h-3 w-4 border border-border-light bg-neutral-50" aria-hidden />
          {copy.legendSection}
        </span>
        <span className="flex items-center gap-1">
          <span className="h-3 w-4 border border-neutral-400 bg-white" aria-hidden />
          {copy.legendPage}
        </span>
        <span className="flex items-center gap-1">
          <span className="h-px w-4 bg-neutral-400" aria-hidden />
          {copy.legendLink}
        </span>
      </div>
    </div>
  );
};

const MapView: React.FC<MapViewProps> = props => (
  <ReactFlowProvider>
    <MapCanvas {...props} />
  </ReactFlowProvider>
);

export default MapView;
