import { useState } from "react";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AttemptLimitField } from "./AttemptLimitField";

const Harness = ({
  initial,
  savedValue,
  isLive,
  canEdit = true,
}: {
  initial: number | null;
  savedValue: number | null | undefined;
  isLive: boolean;
  canEdit?: boolean;
}) => {
  const [value, setValue] = useState<number | null>(initial);
  return (
    <AttemptLimitField
      value={value}
      onChange={setValue}
      savedValue={savedValue}
      isLive={isLive}
      canEdit={canEdit}
    />
  );
};

const box = () => screen.getByRole("spinbutton") as HTMLInputElement;
const unlimited = () => screen.getByRole("checkbox") as HTMLInputElement;

describe("AttemptLimitField on a live course", () => {
  it("floors the box at the saved limit + 1 and keeps it enabled", () => {
    render(<Harness initial={2} savedValue={2} isLive />);
    expect(box()).toBeEnabled();
    expect(box().min).toBe("3");
  });

  it("restores the saved limit when a lower number is left in the box", () => {
    render(<Harness initial={2} savedValue={2} isLive />);
    fireEvent.change(box(), { target: { value: "1" } });
    fireEvent.blur(box());
    expect(box().value).toBe("2");
  });

  it("locks both controls when the saved limit is already unlimited", () => {
    render(<Harness initial={null} savedValue={null} isLive />);
    expect(unlimited()).toBeDisabled();
    expect(box()).toBeDisabled();
  });

  it("locks both controls without Create Courses", () => {
    render(<Harness initial={2} savedValue={2} isLive canEdit={false} />);
    expect(unlimited()).toBeDisabled();
    expect(box()).toBeDisabled();
  });

  it("unticking Unlimited falls back to the saved limit, not 1", () => {
    render(<Harness initial={2} savedValue={2} isLive />);
    fireEvent.click(unlimited());
    expect(unlimited().checked).toBe(true);
    fireEvent.click(unlimited());
    expect(box().value).toBe("2");
  });
});

describe("AttemptLimitField on a draft", () => {
  it("allows any positive number and Unlimited", () => {
    render(<Harness initial={2} savedValue={2} isLive={false} />);
    expect(box().min).toBe("1");
    expect(unlimited()).toBeEnabled();
    fireEvent.change(box(), { target: { value: "1" } });
    fireEvent.blur(box());
    expect(box().value).toBe("1");
  });

  it("does not read an emptied box as Unlimited while retyping", () => {
    render(<Harness initial={2} savedValue={2} isLive={false} />);
    fireEvent.change(box(), { target: { value: "" } });
    expect(box().value).toBe("");
    expect(box()).toBeEnabled();
    expect(unlimited().checked).toBe(false);
    fireEvent.change(box(), { target: { value: "6" } });
    expect(box().value).toBe("6");
    expect(unlimited().checked).toBe(false);
  });

  it("restores the last number when the box is left empty", () => {
    render(<Harness initial={2} savedValue={2} isLive={false} />);
    fireEvent.change(box(), { target: { value: "" } });
    fireEvent.blur(box());
    expect(box().value).toBe("2");
  });

  it("still goes Unlimited from the checkbox", () => {
    render(<Harness initial={2} savedValue={2} isLive={false} />);
    fireEvent.click(unlimited());
    expect(unlimited().checked).toBe(true);
    expect(box()).toBeDisabled();
  });
});
