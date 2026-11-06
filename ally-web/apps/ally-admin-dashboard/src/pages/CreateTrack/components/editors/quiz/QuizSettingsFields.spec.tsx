import { fireEvent, render, screen } from "@testing-library/react";
import { FormProvider, useForm } from "react-hook-form";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { QuizSettingsFields } from "./QuizSettingsFields";

const canAuthorCourses = vi.hoisted(() => ({ value: true }));

vi.mock("@hooks", () => ({
  useContentAuthoring: () => ({ canAuthorCourses: canAuthorCourses.value }),
}));
vi.mock("@assets", () => ({ TooltipIcon: () => null }));
vi.mock("@components", () => ({ ToggleSwitch: () => null }));
vi.mock("@constants", () => ({ QUIZ_SHOW_EXPLANATIONS_OPTIONS: [] }));
vi.mock("@ally-ui-mono/ui-shared", () => ({
  Select: () => null,
  SelectItem: () => null,
  Tooltip: ({ children }: any) => children,
}));

const Harness = ({
  maxAttempts,
  isPublished,
  serverId = "item-1",
}: {
  maxAttempts: number | null;
  isPublished: boolean;
  serverId?: string;
}) => {
  const methods = useForm<any>({
    defaultValues: {
      sections: [{ items: [{ serverId, quiz: { settings: { passScore: 70, maxAttempts } } }] }],
    },
  });
  return (
    <FormProvider {...methods}>
      <QuizSettingsFields sectionIndex={0} itemIndex={0} isPublished={isPublished} />
    </FormProvider>
  );
};

const attemptsInput = () => screen.getAllByRole("spinbutton")[1] as HTMLInputElement;
const unlimited = () => screen.getByRole("checkbox") as HTMLInputElement;

describe("QuizSettingsFields max attempts on a published course", () => {
  beforeEach(() => {
    canAuthorCourses.value = true;
  });

  it("keeps the input enabled", () => {
    render(<Harness maxAttempts={3} isPublished />);
    expect(attemptsInput()).toBeEnabled();
  });

  it("sets min to the current value + 1", () => {
    render(<Harness maxAttempts={3} isPublished />);
    expect(attemptsInput().min).toBe("4");
  });

  it("disables both controls when the quiz is Unlimited", () => {
    render(<Harness maxAttempts={null} isPublished />);
    expect(unlimited()).toBeDisabled();
    expect(attemptsInput()).toBeDisabled();
  });

  it("disables both controls without Create Courses", () => {
    canAuthorCourses.value = false;
    render(<Harness maxAttempts={3} isPublished />);
    expect(unlimited()).toBeDisabled();
    expect(attemptsInput()).toBeDisabled();
  });

  it("leaves a draft course unchanged: min 1, Unlimited allowed", () => {
    render(<Harness maxAttempts={3} isPublished={false} />);
    expect(attemptsInput().min).toBe("1");
    expect(unlimited()).toBeEnabled();
  });

  it("does not read an emptied box as Unlimited while retyping", () => {
    render(<Harness maxAttempts={3} isPublished />);
    fireEvent.change(attemptsInput(), { target: { value: "" } });
    expect(attemptsInput().value).toBe("");
    expect(attemptsInput()).toBeEnabled();
    expect(unlimited().checked).toBe(false);
    fireEvent.change(attemptsInput(), { target: { value: "6" } });
    expect(attemptsInput().value).toBe("6");
    expect(unlimited().checked).toBe(false);
  });

  it("restores the last number when the box is left empty", () => {
    render(<Harness maxAttempts={3} isPublished={false} />);
    fireEvent.change(attemptsInput(), { target: { value: "" } });
    fireEvent.blur(attemptsInput());
    expect(attemptsInput().value).toBe("3");
    expect(unlimited().checked).toBe(false);
  });

  it("still goes Unlimited from the checkbox", () => {
    render(<Harness maxAttempts={3} isPublished={false} />);
    fireEvent.click(unlimited());
    expect(unlimited().checked).toBe(true);
    expect(attemptsInput()).toBeDisabled();
  });
});
