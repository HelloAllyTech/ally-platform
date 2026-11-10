import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setColorMode } from "@hooks/useColorMode";

import { LineChart } from "../index";

const seen = vi.hoisted(() => ({ themes: [] as (string | undefined)[] }));

vi.mock("@carbon/charts-react", () => ({
  LineChart: ({ options }: { options: { theme?: string } }) => {
    seen.themes.push(options.theme);
    return <div data-testid="chart" />;
  },
}));

describe("themed charts", () => {
  beforeEach(() => {
    seen.themes = [];
    localStorage.clear();
    document.documentElement.className = "";
  });

  afterEach(() => {
    localStorage.clear();
    document.documentElement.className = "";
  });

  it("draws the light Carbon theme in light mode and switches with the top-bar toggle", () => {
    render(<LineChart data={[]} options={{ title: "x" }} />);
    expect(seen.themes.at(-1)).toBe("white");

    act(() => setColorMode("dark"));
    expect(seen.themes.at(-1)).toBe("g100");

    act(() => setColorMode("light"));
    expect(seen.themes.at(-1)).toBe("white");
  });

  it("keeps a theme the chart sets itself", () => {
    act(() => setColorMode("dark"));
    render(<LineChart data={[]} options={{ title: "x", theme: "g10" as never }} />);
    expect(seen.themes.at(-1)).toBe("g10");
  });
});
