import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ImageStyle } from "@types";

const api = vi.hoisted(() => ({ jobsArgs: [] as unknown[] }));

const style = (id: string, name: string): ImageStyle => ({
  id,
  name,
  description: "",
  kind: "illustration",
  thumbnailUrl: "",
  swatch: ["#000000", "#ffffff"],
  recommendedSlots: [],
});

vi.mock("@api", () => ({
  useGetImageStylesQuery: () => ({
    data: [style("documentary_photo", "Documentary photo"), style("watercolour", "Watercolour")],
    isLoading: false,
  }),
  useGetImageJobsQuery: (ids: string[], options: unknown) => {
    api.jobsArgs.push([ids, options]);
    return {
      data: ids.length
        ? [{ id: "anchor-1", status: "succeeded", imageUrl: "https://b/anchor.webp" }]
        : undefined,
    };
  },
}));

vi.mock("@ally-ui-mono/ui-shared", () => ({
  CustomImage: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));

import CourseStylePicker from "../CourseStylePicker";

describe("CourseStylePicker", () => {
  beforeEach(() => {
    api.jobsArgs = [];
  });

  it("is a labelled radio group: picking a style sets it, and 'No course style' clears it", () => {
    const onChange = vi.fn();
    render(<CourseStylePicker value="watercolour" onChange={onChange} onClearAnchor={vi.fn()} />);

    expect(screen.getByRole("radiogroup", { name: "Visual style" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Watercolour/ })).toBeChecked();

    fireEvent.click(screen.getByRole("radio", { name: /Documentary photo/ }));
    expect(onChange).toHaveBeenCalledWith("documentary_photo");

    fireEvent.click(screen.getByRole("button", { name: "No course style" }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("shows the style example, which Clear removes", () => {
    const onClearAnchor = vi.fn();
    render(
      <CourseStylePicker
        value="watercolour"
        onChange={vi.fn()}
        anchorId="anchor-1"
        onClearAnchor={onClearAnchor}
      />,
    );

    expect(screen.getByAltText("This course's style example")).toHaveAttribute(
      "src",
      "https://b/anchor.webp",
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(onClearAnchor).toHaveBeenCalled();
  });

  it("doesn't look up an example the course doesn't have", () => {
    render(<CourseStylePicker value={null} onChange={vi.fn()} onClearAnchor={vi.fn()} />);

    expect(screen.queryByText("Style example")).toBeNull();
    expect(api.jobsArgs[0]).toEqual([[], { skip: true }]);
    expect(screen.getByText("No course style yet — each image picks its own.")).toBeVisible();
  });
});
