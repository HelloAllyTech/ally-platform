import React from "react";

import { Moon, Sun } from "@icons";

import { Tooltip } from "@ally-ui-mono/ui-shared";
import { en } from "@constants";
import { useColorMode } from "@hooks/useColorMode";

/**
 * One-tap light/dark switch in the primary sidebar, beside the idea-capture mic. The icon shows what a
 * tap will do: a moon in light mode, a sun in dark mode.
 */
export const ColorModeToggle: React.FC = () => {
  const { isDark, toggle } = useColorMode();
  const label = isDark ? en.colorMode.switchToLight : en.colorMode.switchToDark;

  return (
    <Tooltip label={label} align="right">
      <button
        type="button"
        onClick={toggle}
        aria-label={label}
        aria-pressed={isDark}
        data-testid="color-mode-toggle"
        className="text-typography-secondary hover:text-primary-500 inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-full transition hover:bg-background-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500"
      >
        {isDark ? (
          <Sun size={22} aria-hidden="true" data-testid="color-mode-icon-sun" />
        ) : (
          <Moon size={22} aria-hidden="true" data-testid="color-mode-icon-moon" />
        )}
      </button>
    </Tooltip>
  );
};

export default ColorModeToggle;
