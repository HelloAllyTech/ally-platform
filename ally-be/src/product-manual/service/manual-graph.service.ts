import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { GraphNode, ManualGraph } from '../type/manual.types';

/** The map: every live page as a node; `[[links]]` between two live pages as an edge. */
@Injectable()
export class ManualGraphService {
  constructor(private readonly dataSource: DataSource) {}

  async graph(): Promise<ManualGraph> {
    const [nodes, edges]: [GraphNode[], { from: string; to: string }[]] =
      await Promise.all([
        this.dataSource.query(
          `SELECT slug, title, parent_slug AS "parentSlug", kind
           FROM manual_pages
          WHERE deleted_at IS NULL
          ORDER BY parent_slug NULLS FIRST, position, title`,
        ),
        this.dataSource.query(
          `SELECT l.from_slug AS "from", l.to_slug AS "to"
           FROM manual_links l
           JOIN manual_pages a ON a.slug = l.from_slug AND a.deleted_at IS NULL
           JOIN manual_pages b ON b.slug = l.to_slug AND b.deleted_at IS NULL
          WHERE l.from_slug <> l.to_slug
          ORDER BY l.from_slug, l.to_slug`,
        ),
      ]);
    return {
      nodes: nodes.map((n) => ({
        slug: n.slug,
        title: n.title,
        parentSlug: n.parentSlug ?? null,
        kind: n.kind,
      })),
      edges: edges.map((e) => ({ from: e.from, to: e.to })),
    };
  }
}
