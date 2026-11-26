import "@constants";
import React from "react";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { en } from "@constants";

const importMock = vi.fn();
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<typeof import("@api")>()),
  useImportManualPagesMutation: () => [importMock],
}));

import { ImportSection } from "../components/AdminDrawer";

const copy = en.productManual.admin;

const fileOf = (pages: unknown, name = "bundle.json") =>
  new File([typeof pages === "string" ? pages : JSON.stringify(pages)], name, {
    type: "application/json",
  });

const pickFile = (file: File) => {
  const input = screen.getByLabelText(copy.importChoose, { selector: "input" });
  fireEvent.change(input, { target: { files: [file] } });
};

const pages = (count: number) =>
  Array.from({ length: count }, (_, i) => ({ slug: `page-${i}`, title: `Page ${i}` }));

const ok = (created: number, errors: string[] = []) => ({
  unwrap: () => Promise.resolve({ created, updated: 0, unchanged: 0, errors }),
});

describe("ImportSection", () => {
  beforeEach(() => importMock.mockReset());

  it("shows how many pages a chosen file holds and imports them", async () => {
    importMock.mockReturnValue(ok(2));
    render(<ImportSection />);
    pickFile(fileOf({ pages: pages(2) }));
    expect(await screen.findByText(copy.importChosen("bundle.json", 2))).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: copy.importRun(2) }));
    expect(await screen.findByText(copy.importDone(2, 0, 0))).toBeTruthy();
    expect(importMock).toHaveBeenCalledTimes(1);
    expect(importMock.mock.calls[0][0]).toHaveLength(2);
  });

  it("sends a large file in several parts and adds the results up", async () => {
    importMock.mockReturnValue(ok(10));
    render(<ImportSection />);
    pickFile(fileOf({ pages: pages(100) }));
    fireEvent.click(await screen.findByRole("button", { name: copy.importRun(100) }));
    expect(await screen.findByText(copy.importDone(20, 0, 0))).toBeTruthy();
    expect(importMock).toHaveBeenCalledTimes(2);
    expect(importMock.mock.calls.map(c => c[0].length)).toEqual([90, 10]);
  });

  it("lists pages the server refused", async () => {
    importMock.mockReturnValue(ok(1, ["secret-page: contains an API key"]));
    render(<ImportSection />);
    pickFile(fileOf(pages(2)));
    fireEvent.click(await screen.findByRole("button", { name: copy.importRun(2) }));
    expect(await screen.findByText(copy.importRefused)).toBeTruthy();
    expect(screen.getByText("secret-page: contains an API key")).toBeTruthy();
  });

  it("says what is wrong with a bad file and offers no import button", async () => {
    render(<ImportSection />);
    pickFile(fileOf("{nope"));
    expect((await screen.findByRole("alert")).textContent).toBe(copy.importNotJson);
    expect(screen.queryByRole("button", { name: /^Import/ })).toBeNull();

    pickFile(fileOf([{ slug: "Bad Slug", title: "x" }]));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(copy.importBadPage(1)));
    expect(importMock).not.toHaveBeenCalled();
  });

  it("stops at the first failing part and says so, keeping what was already saved", async () => {
    importMock
      .mockReturnValueOnce(ok(90))
      .mockReturnValueOnce({ unwrap: () => Promise.reject({ status: 500 }) });
    render(<ImportSection />);
    pickFile(fileOf(pages(100)));
    fireEvent.click(await screen.findByRole("button", { name: copy.importRun(100) }));
    expect((await screen.findByRole("alert")).textContent).toBe(copy.importFailed);
    expect(screen.getByText(copy.importDone(90, 0, 0))).toBeTruthy();
    expect(importMock).toHaveBeenCalledTimes(2);
  });
});
