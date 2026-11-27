import React from "react";

import { Link } from "react-router-dom";

import { en } from "@constants";
import type { ManualGraph } from "@types";

import { mapColumns } from "../utils/mapLayout";
import { manualHref } from "../utils/wikilinks";

/**
 * The map as a plain list, for when the map library can't load: each section, its pages, and
 * what each page links to.
 */
export const MapListFallback: React.FC<{ graph: ManualGraph; note?: boolean }> = ({
  graph,
  note = true,
}) => {
  const copy = en.productManual.mapView;
  const titles = new Map(graph.nodes.map(node => [node.slug, node.title]));
  const outOf = (slug: string) =>
    graph.edges.filter(edge => edge.from === slug && titles.has(edge.to)).map(edge => edge.to);
  return (
    <div className="flex flex-col gap-6">
      {note && <p className="m-0 text-sm text-typography-600">{copy.fallback}</p>}
      {mapColumns(graph).map(column => (
        <section key={column.section?.slug ?? "other"} className="flex flex-col gap-2">
          <h3 className="m-0 text-sm font-semibold text-typography-900">
            {column.section ? (
              <Link to={manualHref(column.section.slug)} className="hover:underline">
                {column.section.title}
              </Link>
            ) : (
              copy.other
            )}
          </h3>
          <ul className="m-0 flex list-none flex-col gap-1 p-0 pl-3">
            {column.pages.map(page => {
              const links = outOf(page.slug);
              return (
                <li key={page.slug} className="text-sm">
                  <Link to={manualHref(page.slug)} className="text-primary-700 hover:underline">
                    {page.title}
                  </Link>
                  {links.length > 0 && (
                    <span className="text-xs text-typography-600">
                      {" "}
                      · {copy.linksTo}{" "}
                      {links.map((slug, index) => (
                        <React.Fragment key={slug}>
                          {index > 0 && ", "}
                          <Link to={manualHref(slug)} className="hover:underline">
                            {titles.get(slug)}
                          </Link>
                        </React.Fragment>
                      ))}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
};
