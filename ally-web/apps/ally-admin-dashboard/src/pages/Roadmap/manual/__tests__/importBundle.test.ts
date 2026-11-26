import "@constants";
import { describe, expect, it } from "vitest";

import type { ManualImportPage } from "@types";

import {
  IMPORT_CHUNK_BYTES,
  IMPORT_CHUNK_PAGES,
  IMPORT_MAX_PAGES,
  chunkImportPages,
  parseImportBundle,
} from "../utils/importBundle";

const page = (n: number, body = ""): ManualImportPage => ({
  slug: `page-${n}`,
  title: `Page ${n}`,
  body,
});

describe("parseImportBundle", () => {
  it("accepts the bundle shape and a bare list", () => {
    const pages = [page(1), page(2)];
    expect(parseImportBundle(JSON.stringify({ pages }))).toEqual({ ok: true, pages });
    expect(parseImportBundle(JSON.stringify(pages))).toEqual({ ok: true, pages });
  });

  it("explains a file that is not JSON, not a list, or empty", () => {
    expect(parseImportBundle("{nope")).toEqual({ ok: false, error: "notJson" });
    expect(parseImportBundle('{"pages":"x"}')).toEqual({ ok: false, error: "shape" });
    expect(parseImportBundle("null")).toEqual({ ok: false, error: "shape" });
    expect(parseImportBundle('{"pages":[]}')).toEqual({ ok: false, error: "empty" });
  });

  it("points at the first bad page by its 1-based position", () => {
    const bad = [page(1), { slug: "Has Spaces", title: "X" }, page(3)];
    expect(parseImportBundle(JSON.stringify(bad))).toEqual({
      ok: false,
      error: "badPage",
      position: 2,
    });
    expect(parseImportBundle(JSON.stringify([page(1), { slug: "ok", title: "  " }]))).toEqual({
      ok: false,
      error: "badPage",
      position: 2,
    });
    expect(parseImportBundle(JSON.stringify([null]))).toEqual({
      ok: false,
      error: "badPage",
      position: 1,
    });
  });

  it("refuses a slug over 120 characters and a file with too many pages", () => {
    const long = { slug: "a".repeat(121), title: "Long" };
    expect(parseImportBundle(JSON.stringify([long]))).toMatchObject({ error: "badPage" });
    const many = Array.from({ length: IMPORT_MAX_PAGES + 1 }, (_, i) => page(i));
    expect(parseImportBundle(JSON.stringify(many))).toEqual({ ok: false, error: "tooMany" });
  });
});

describe("chunkImportPages", () => {
  it("keeps a small set in one request", () => {
    expect(chunkImportPages([page(1), page(2)])).toHaveLength(1);
  });

  it("splits by page count and keeps order", () => {
    const pages = Array.from({ length: IMPORT_CHUNK_PAGES * 2 + 1 }, (_, i) => page(i));
    const chunks = chunkImportPages(pages);
    expect(chunks.map(c => c.length)).toEqual([IMPORT_CHUNK_PAGES, IMPORT_CHUNK_PAGES, 1]);
    expect(chunks.flat()).toEqual(pages);
  });

  it("splits by size so long pages never build a huge request", () => {
    const body = "x".repeat(Math.floor(IMPORT_CHUNK_BYTES / 2) + 1000);
    const chunks = chunkImportPages([page(1, body), page(2, body), page(3, body)]);
    expect(chunks.map(c => c.length)).toEqual([1, 1, 1]);
  });

  it("returns nothing for nothing", () => {
    expect(chunkImportPages([])).toEqual([]);
  });
});
