import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BuilderSession } from "@types";

import { interviewFixture } from "./evalTestData";

vi.mock("@components", () => ({ cellTypes: {} }));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

let sessionsResult: { data?: BuilderSession[]; isLoading: boolean; isError: boolean };
const createFromSession = vi.fn();
const createFromExport = vi.fn();
const importFixtures = vi.fn();
vi.mock("@api", () => ({
  useGetBuilderSessionsQuery: () => sessionsResult,
  useCreateBuilderEvalFixtureFromSessionMutation: () => [createFromSession, { isLoading: false }],
  useCreateBuilderEvalFixtureFromExportMutation: () => [createFromExport, { isLoading: false }],
  useImportBuilderEvalFixturesMutation: () => [importFixtures, { isLoading: false }],
}));

// eslint-disable-next-line import/first
import { en } from "@constants";

// eslint-disable-next-line import/first
import { FromSessionDialog, PasteExportDialog } from "../eval/AddFixtureDialogs";

const session = (overrides: Partial<BuilderSession>): BuilderSession => ({
  id: "s1",
  title: "Weekly digest email",
  slug: "weekly-digest-email",
  status: "PRD_READY",
  currentStage: null,
  repos: null,
  model: null,
  lastMessageSeq: 0,
  budgetUsd: null,
  totalCostUsd: "0",
  runnerMinutes: 0,
  error: null,
  archivedAt: null,
  createdBy: 1,
  createdAt: "2026-10-10T00:00:00.000Z",
  updatedAt: "2026-10-10T00:00:00.000Z",
  ...overrides,
});

const ok = <T,>(value: T) => ({ unwrap: () => Promise.resolve(value) });
const refused = (status: number, message?: string) => ({
  unwrap: () => Promise.reject({ status, data: message ? { message } : undefined }),
});

const strings = en.builder.eval;

beforeEach(() => {
  vi.clearAllMocks();
  sessionsResult = {
    data: [
      session({ id: "old", title: "Older session", createdAt: "2026-09-01T00:00:00.000Z" }),
      session({ id: "new", title: "Newest session", createdAt: "2026-10-15T00:00:00.000Z" }),
    ],
    isLoading: false,
    isError: false,
  };
  createFromSession.mockReturnValue(ok(interviewFixture()));
  createFromExport.mockReturnValue(ok(interviewFixture()));
  importFixtures.mockReturnValue(ok({ created: 2, updated: 1 }));
});

describe("FromSessionDialog", () => {
  const renderDialog = () => {
    const onClose = vi.fn();
    const onCreated = vi.fn();
    render(<FromSessionDialog onClose={onClose} onCreated={onCreated} />);
    return { onClose, onCreated };
  };
  const picker = () => screen.getByLabelText(strings.fromSession.sessionLabel);
  const submit = () => screen.getByRole("button", { name: strings.fromSession.submit });

  it("lists the recent sessions, newest first", () => {
    renderDialog();

    const options = Array.from(picker().querySelectorAll("option")).map(option => option.value);
    expect(options).toEqual(["", "new", "old"]);
  });

  it("will not save until a session is chosen", () => {
    renderDialog();
    expect(submit()).toBeDisabled();
  });

  it("names the fixture after the session until the person names it", () => {
    renderDialog();

    fireEvent.change(picker(), { target: { value: "new" } });
    expect(screen.getByLabelText(strings.fromSession.nameLabel)).toHaveValue("Newest session");

    fireEvent.change(screen.getByLabelText(strings.fromSession.nameLabel), {
      target: { value: "Asked before reading" },
    });
    fireEvent.change(picker(), { target: { value: "old" } });
    expect(screen.getByLabelText(strings.fromSession.nameLabel)).toHaveValue(
      "Asked before reading",
    );
  });

  it("saves the session as a fixture and hands it back to be opened", async () => {
    const { onClose, onCreated } = renderDialog();

    fireEvent.change(picker(), { target: { value: "new" } });
    fireEvent.change(screen.getByLabelText(strings.fromSession.notesLabel, { exact: false }), {
      target: { value: "  Asked six questions it never read  " },
    });
    fireEvent.click(submit());

    await waitFor(() => expect(createFromSession).toHaveBeenCalledTimes(1));
    expect(createFromSession).toHaveBeenCalledWith({
      sessionId: "new",
      name: "Newest session",
      notes: "Asked six questions it never read",
    });
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(interviewFixture()));
    expect(onClose).toHaveBeenCalled();
    expect(toastSuccess).toHaveBeenCalledWith(strings.fromSession.created);
  });

  it("leaves the note out when there is none", async () => {
    renderDialog();
    fireEvent.change(picker(), { target: { value: "new" } });
    fireEvent.click(submit());

    await waitFor(() => expect(createFromSession).toHaveBeenCalled());
    expect(createFromSession.mock.calls[0][0]).not.toHaveProperty("notes");
  });

  it("stays open and shows the server's message when it is refused", async () => {
    createFromSession.mockReturnValue(
      refused(409, 'A fixture named "Newest session" already exists.'),
    );
    const { onClose, onCreated } = renderDialog();

    fireEvent.change(picker(), { target: { value: "new" } });
    fireEvent.click(submit());

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('A fixture named "Newest session" already exists.'),
    );
    expect(onCreated).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("says plainly that the fixture holds what an admin typed", () => {
    renderDialog();
    expect(screen.getByText(strings.privacy.short)).toBeInTheDocument();
  });

  it("copes with a sessions list that has not arrived", () => {
    sessionsResult = { data: undefined, isLoading: true, isError: false };
    renderDialog();

    expect(picker()).toBeDisabled();
    expect(screen.getByText(strings.fromSession.loading)).toBeInTheDocument();
  });

  it("says when there are no sessions to choose from", () => {
    sessionsResult = { data: [], isLoading: false, isError: false };
    renderDialog();
    expect(screen.getByText(strings.fromSession.none)).toBeInTheDocument();
  });
});

describe("PasteExportDialog", () => {
  const renderDialog = () => {
    const onClose = vi.fn();
    const onCreated = vi.fn();
    render(<PasteExportDialog onClose={onClose} onCreated={onCreated} />);
    return { onClose, onCreated };
  };
  const box = () => screen.getByLabelText(strings.paste.jsonLabel);
  const paste = (value: unknown) =>
    fireEvent.change(box(), {
      target: { value: typeof value === "string" ? value : JSON.stringify(value) },
    });

  it("starts with nothing to import", () => {
    renderDialog();
    expect(screen.getByRole("button", { name: strings.paste.submit })).toBeDisabled();
  });

  it("imports a fixtures export, saying how many and that names are matched", async () => {
    const { onClose } = renderDialog();
    const fixtures = [{ name: "One" }, { name: "Two" }, { name: "Three" }];
    paste({ version: 1, fixtures });

    expect(screen.getByText(strings.paste.foundFixtures(3))).toBeInTheDocument();
    expect(screen.getByText(strings.paste.matchedByName)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: strings.paste.importCount(3) }));

    await waitFor(() => expect(importFixtures).toHaveBeenCalledWith({ fixtures }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith(strings.paste.imported(2, 1)));
    expect(onClose).toHaveBeenCalled();
  });

  it("rejects text that is not JSON, and says so", () => {
    renderDialog();
    paste("{ not json");

    expect(screen.getByText(strings.paste.invalid.notJson)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: strings.paste.submit })).toBeDisabled();
  });

  it("rejects JSON that is neither an export nor a session", () => {
    renderDialog();
    paste({ hello: "world" });

    expect(screen.getByText(strings.paste.invalid.unrecognised)).toBeInTheDocument();
  });

  it("rejects an export with no fixtures in it", () => {
    renderDialog();
    paste({ version: 1, fixtures: [] });

    expect(screen.getByText(strings.paste.invalid.noFixtures)).toBeInTheDocument();
  });

  it("cuts a pasted session into one fixture, named after it by default", async () => {
    const { onCreated, onClose } = renderDialog();
    const body = { id: "s1", title: "Digest email", messages: [{ role: "user", content: "hi" }] };
    paste(body);

    expect(screen.getByText(strings.paste.foundSession)).toBeInTheDocument();
    expect(screen.getByLabelText(strings.paste.nameLabel)).toHaveValue("Digest email");

    fireEvent.click(screen.getByRole("button", { name: strings.paste.saveSession }));

    await waitFor(() =>
      expect(createFromExport).toHaveBeenCalledWith({ name: "Digest email", session: body }),
    );
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
    expect(importFixtures).not.toHaveBeenCalled();
  });

  it("needs a name for a session that has none", () => {
    renderDialog();
    paste({ id: "s1", messages: [] });

    expect(screen.getByRole("button", { name: strings.paste.saveSession })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(strings.paste.nameLabel), {
      target: { value: "Named by hand" },
    });
    expect(screen.getByRole("button", { name: strings.paste.saveSession })).toBeEnabled();
  });

  it("shows the server's message when the import is refused, and stays open", async () => {
    importFixtures.mockReturnValue(refused(400, "Too many fixtures"));
    const { onClose } = renderDialog();
    paste([{ name: "One" }]);
    fireEvent.click(screen.getByRole("button", { name: strings.paste.importCount(1) }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Too many fixtures"));
    expect(onClose).not.toHaveBeenCalled();
  });
});
