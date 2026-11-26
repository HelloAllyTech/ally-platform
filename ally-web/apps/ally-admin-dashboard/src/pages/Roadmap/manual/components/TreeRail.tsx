import React, { useEffect, useMemo, useRef, useState } from "react";

import { ChevronRight } from "@carbon/icons-react";
import { motion } from "framer-motion";

import { en } from "@constants";
import type { ManualPageRow } from "@types";

import { motionTransition, springTransition, useReducedMotionPreference } from "../../../../motion";
import {
  ManualTreeFilters,
  ManualTreeNode,
  ancestorsOf,
  buildTree,
  collectFacets,
  flattenVisible,
  hasFilters,
} from "../utils/tree";

const Chip: React.FC<{ label: string; on: boolean; onClick: () => void }> = ({
  label,
  on,
  onClick,
}) => (
  <button
    type="button"
    aria-pressed={on}
    onClick={onClick}
    className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors duration-100 ${
      on
        ? "border-primary-600 bg-primary-50 text-primary-700"
        : "border-border-light bg-white text-typography-700 hover:border-neutral-400"
    }`}
  >
    {label}
  </button>
);

const FacetChips: React.FC<{
  label: string;
  values: string[];
  value: string | null | undefined;
  onChange: (value: string | null) => void;
}> = ({ label, values, value, onChange }) => {
  if (values.length === 0) return null;
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-1">
      <span className="text-xs text-typography-600">{label}</span>
      <div className="flex flex-wrap gap-1">
        {values.map(item => (
          <Chip
            key={item}
            label={item}
            on={value === item}
            onClick={() => onChange(value === item ? null : item)}
          />
        ))}
      </div>
    </div>
  );
};

export interface TreeRailProps {
  pages: ManualPageRow[];
  currentSlug: string | null;
  onNavigate: (slug: string) => void;
  onOpenRecentChanges?: () => void;
  /** Footer content (the "Checked against the code" note, the gaps link). */
  footer?: React.ReactNode;
}

/**
 * The journey tree: sections → pages, collapsible, with a thin indicator that glides to the page
 * you are reading. A tree in the ARIA sense: one tab stop, arrows move, Right/Left open and close
 * a section, Enter opens a page (or toggles a section), Home/End jump.
 */
export const TreeRail: React.FC<TreeRailProps> = ({
  pages,
  currentSlug,
  onNavigate,
  onOpenRecentChanges,
  footer,
}) => {
  const copy = en.productManual.tree;
  const reduced = useReducedMotionPreference();
  const [filters, setFilters] = useState<ManualTreeFilters>({});
  const facets = useMemo(() => collectFacets(pages), [pages]);
  const tree = useMemo(() => buildTree(pages, filters), [pages, filters]);
  const filtering = hasFilters(filters);

  // Sections start closed, except those on the way to the current page.
  const [open, setOpen] = useState<Set<string>>(() => new Set(ancestorsOf(pages, currentSlug)));
  useEffect(() => {
    const chain = ancestorsOf(pages, currentSlug);
    if (chain.length === 0) return;
    setOpen(current => {
      if (chain.every(slug => current.has(slug))) return current;
      const next = new Set(current);
      chain.forEach(slug => next.add(slug));
      return next;
    });
  }, [pages, currentSlug]);
  // While filtering, every section with a match is open: the point is to see the matches.
  const isOpen = (slug: string) => filtering || open.has(slug);
  const visible = flattenVisible(tree, isOpen);

  const [focusSlug, setFocusSlug] = useState<string | null>(null);
  const activeSlug =
    focusSlug && visible.some(node => node.slug === focusSlug)
      ? focusSlug
      : (visible.find(node => node.slug === currentSlug)?.slug ?? visible[0]?.slug ?? null);
  const rowRefs = useRef(new Map<string, HTMLElement>());

  const toggle = (slug: string) =>
    setOpen(current => {
      const next = new Set(current);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });

  const focusRow = (slug: string | undefined) => {
    if (!slug) return;
    setFocusSlug(slug);
    rowRefs.current.get(slug)?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent, node: ManualTreeNode) => {
    const at = visible.findIndex(item => item.slug === node.slug);
    const hasChildren = node.children.length > 0;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusRow(visible[at + 1]?.slug);
        break;
      case "ArrowUp":
        event.preventDefault();
        focusRow(visible[at - 1]?.slug);
        break;
      case "Home":
        event.preventDefault();
        focusRow(visible[0]?.slug);
        break;
      case "End":
        event.preventDefault();
        focusRow(visible[visible.length - 1]?.slug);
        break;
      case "ArrowRight":
        event.preventDefault();
        if (hasChildren && !isOpen(node.slug)) toggle(node.slug);
        else if (hasChildren) focusRow(node.children[0]?.slug);
        break;
      case "ArrowLeft":
        event.preventDefault();
        if (hasChildren && isOpen(node.slug) && !filtering) toggle(node.slug);
        else if (node.parentSlug) focusRow(node.parentSlug);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        if (node.kind === "section" && hasChildren && event.key === " ") toggle(node.slug);
        else onNavigate(node.slug);
        break;
      default:
    }
  };

  const renderNode = (node: ManualTreeNode): React.ReactNode => {
    const hasChildren = node.children.length > 0;
    const expanded = hasChildren ? isOpen(node.slug) : undefined;
    const current = node.slug === currentSlug;
    return (
      <li
        key={node.slug}
        role="none"
        className="flex flex-col"
        data-testid={`manual-tree-${node.slug}`}
      >
        <div
          ref={element => {
            if (element) rowRefs.current.set(node.slug, element);
            else rowRefs.current.delete(node.slug);
          }}
          role="treeitem"
          aria-level={node.depth + 1}
          aria-expanded={expanded}
          aria-selected={current}
          aria-current={current ? "page" : undefined}
          tabIndex={node.slug === activeSlug ? 0 : -1}
          onKeyDown={event => onKeyDown(event, node)}
          onFocus={() => setFocusSlug(node.slug)}
          onClick={() => onNavigate(node.slug)}
          className={`group relative flex min-h-8 cursor-pointer items-center gap-1 py-1 pr-2 text-sm outline-none focus-visible:bg-neutral-100 ${
            current
              ? "font-semibold text-typography-900"
              : node.kind === "section"
                ? "font-medium text-typography-800 hover:bg-neutral-50"
                : "text-typography-700 hover:bg-neutral-50 hover:text-typography-900"
          }`}
          style={{ paddingLeft: `${0.5 + node.depth * 0.875}rem` }}
        >
          {current && (
            <motion.span
              layoutId="manual-tree-indicator"
              aria-hidden
              className="absolute inset-y-1 left-0 w-0.5 bg-primary-600"
              transition={springTransition(reduced)}
            />
          )}
          {hasChildren ? (
            <button
              type="button"
              tabIndex={-1}
              aria-label={expanded ? copy.collapse(node.title) : copy.expand(node.title)}
              onClick={event => {
                event.stopPropagation();
                toggle(node.slug);
              }}
              className="flex h-5 w-5 shrink-0 items-center justify-center text-typography-500"
            >
              <motion.span
                className="flex"
                initial={false}
                animate={{ rotate: expanded ? 90 : 0 }}
                transition={motionTransition("fast", "productive", reduced)}
              >
                <ChevronRight size={14} aria-hidden />
              </motion.span>
            </button>
          ) : (
            <span className="w-5 shrink-0" aria-hidden />
          )}
          <span className="min-w-0 flex-1 truncate">{node.title}</span>
          {node.releaseState === "next" && (
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary-600"
              title={en.productManual.shipsNextDot}
            >
              <span className="sr-only">{en.productManual.shipsNextDot}</span>
            </span>
          )}
        </div>
        {hasChildren && expanded && (
          <ul role="group" className="m-0 list-none p-0">
            {node.children.map(renderNode)}
          </ul>
        )}
      </li>
    );
  };

  return (
    <nav aria-label={copy.label} className="flex h-full min-h-0 flex-col">
      {(facets.roles.length > 0 || facets.surfaces.length > 0) && (
        <div className="flex flex-col gap-2 border-b border-border-light px-3 py-3">
          <FacetChips
            label={copy.role}
            values={facets.roles}
            value={filters.role}
            onChange={role => setFilters(current => ({ ...current, role }))}
          />
          <FacetChips
            label={copy.surface}
            values={facets.surfaces}
            value={filters.surface}
            onChange={surface => setFilters(current => ({ ...current, surface }))}
          />
          {filtering && (
            <button
              type="button"
              onClick={() => setFilters({})}
              className="self-start text-xs text-primary-700 hover:underline"
            >
              {copy.clearFilters}
            </button>
          )}
        </div>
      )}
      <div className="manual-scroll min-h-0 flex-1 overflow-y-auto py-2">
        {tree.length === 0 ? (
          <p className="m-0 px-3 py-2 text-sm text-typography-600">
            {filtering ? copy.noMatches : en.productManual.emptyManual}
          </p>
        ) : (
          <ul role="tree" aria-label={copy.label} className="m-0 list-none p-0">
            {tree.map(renderNode)}
          </ul>
        )}
      </div>
      <div className="flex flex-col gap-1 border-t border-border-light px-3 py-3 text-xs text-typography-600">
        {onOpenRecentChanges && (
          <button
            type="button"
            onClick={onOpenRecentChanges}
            className="self-start text-sm text-primary-700 hover:underline"
          >
            {copy.recentChanges}
          </button>
        )}
        {footer}
      </div>
    </nav>
  );
};
