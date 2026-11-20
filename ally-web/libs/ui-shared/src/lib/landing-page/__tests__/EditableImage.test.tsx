import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { EditableImage } from "../EditableImage";

const file = () => new File(["x"], "hero.png", { type: "image/png" });
const chooseFile = (input: HTMLInputElement) =>
  fireEvent.change(input, { target: { files: [file()] } });

describe("EditableImage", () => {
  it("is just the image for a visitor, with no controls", () => {
    render(
      <EditableImage
        src="https://x.test/a.png"
        alt="A"
        editable={false}
        emptyLabel="Add"
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("img", { name: "A" })).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("is nothing for a visitor when there is no image", () => {
    const { container } = render(
      <EditableImage src={null} alt="" editable={false} emptyLabel="Add" onChange={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("offers replace and remove on an image while editing", () => {
    render(
      <EditableImage
        src="https://x.test/a.png"
        alt="A"
        editable
        emptyLabel="hero image"
        onChange={vi.fn()}
        onUpload={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /Replace image/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Remove image/ })).toBeTruthy();
  });

  it("removes the image", () => {
    const onChange = vi.fn();
    render(
      <EditableImage
        src="https://x.test/a.png"
        alt="A"
        editable
        emptyLabel="hero image"
        onChange={onChange}
        onUpload={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Remove image/ }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("does not offer remove for an image that cannot be removed", () => {
    render(
      <EditableImage
        src="https://x.test/a.png"
        alt="A"
        editable
        removable={false}
        emptyLabel="logo"
        onChange={vi.fn()}
        onUpload={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /Remove image/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Replace image/ })).toBeTruthy();
  });

  it("shows an add target when empty, and stores the address the upload returns", async () => {
    const onChange = vi.fn();
    const onUpload = vi.fn().mockResolvedValue("https://x.test/uploaded.png");
    const { container } = render(
      <EditableImage
        src={null}
        alt=""
        editable
        emptyLabel="Add a hero image"
        onChange={onChange}
        onUpload={onUpload}
      />,
    );
    expect(screen.getByRole("button", { name: "Add a hero image" })).toBeTruthy();
    chooseFile(container.querySelector("input[type=file]") as HTMLInputElement);
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("https://x.test/uploaded.png"));
    expect(onUpload).toHaveBeenCalledWith(expect.any(File));
  });

  it("tells the editor when an upload fails, and leaves the image alone", async () => {
    const onChange = vi.fn();
    const onUpload = vi.fn().mockRejectedValue(new Error("File size must be 3 MB or less"));
    const { container } = render(
      <EditableImage
        src={null}
        alt=""
        editable
        emptyLabel="Add"
        onChange={onChange}
        onUpload={onUpload}
      />,
    );
    chooseFile(container.querySelector("input[type=file]") as HTMLInputElement);
    expect((await screen.findByRole("alert")).textContent).toBe("File size must be 3 MB or less");
    expect(onChange).not.toHaveBeenCalled();
  });
});
