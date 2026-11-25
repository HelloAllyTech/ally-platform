import React from "react";

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

import { BuildBreadcrumb } from "../create/BuildBreadcrumb";

const mount = (onRename = vi.fn(async () => true), name = "Your new Ally Chatbot 2511261") => {
  render(
    <MemoryRouter>
      <BuildBreadcrumb name={name} onRename={onRename} />
    </MemoryRouter>,
  );
  return onRename;
};
const edit = () => fireEvent.click(screen.getByTestId("build-name"));
const input = () => screen.getByTestId("build-name-input") as HTMLInputElement;

describe("BuildBreadcrumb", () => {
  afterEach(cleanup);

  it("reads 'Back to Ally Chatbots / name', the way back first", () => {
    mount();
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Ally Chatbots" })).toHaveAttribute(
      "href",
      "/assistants",
    );
    expect(screen.getByTestId("build-name")).toHaveTextContent("Your new Ally Chatbot 2511261");
  });

  it("renames in place: Enter saves the trimmed name and closes the box", async () => {
    const onRename = mount();
    edit();
    expect(input().value).toBe("Your new Ally Chatbot 2511261");
    fireEvent.change(input(), { target: { value: "  Saathi Helpline  " } });
    fireEvent.keyDown(input(), { key: "Enter" });
    await waitFor(() => expect(onRename).toHaveBeenCalledWith("Saathi Helpline"));
    await waitFor(() => expect(screen.queryByTestId("build-name-input")).toBeNull());
    expect(onRename).toHaveBeenCalledTimes(1);
  });

  it("saves when the box is left, once", async () => {
    const onRename = mount();
    edit();
    fireEvent.change(input(), { target: { value: "Sunrise" } });
    fireEvent.blur(input());
    await waitFor(() => expect(onRename).toHaveBeenCalledWith("Sunrise"));
    expect(onRename).toHaveBeenCalledTimes(1);
  });

  it("does not save an unchanged or empty name, and Escape puts the old one back", async () => {
    const onRename = mount();
    edit();
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(onRename).not.toHaveBeenCalled();
    edit();
    fireEvent.change(input(), { target: { value: "   " } });
    fireEvent.blur(input());
    expect(onRename).not.toHaveBeenCalled();
    edit();
    fireEvent.change(input(), { target: { value: "Something else" } });
    fireEvent.keyDown(input(), { key: "Escape" });
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 5));
    });
    expect(onRename).not.toHaveBeenCalled();
    expect(screen.getByTestId("build-name")).toHaveTextContent("Your new Ally Chatbot 2511261");
  });

  it("keeps the box open with the reason when the save fails", async () => {
    mount(vi.fn(async () => false));
    edit();
    fireEvent.change(input(), { target: { value: "Sunrise" } });
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save the name");
    expect(input().value).toBe("Sunrise");
  });
});
