import React from "react";

import { Book } from "@icons";

import { Tooltip } from "@ally-ui-mono/ui-shared";
import { en } from "@constants";

/**
 * The Core Concepts page of the Developer Wiki. The Roadmap links to the published page itself,
 * in a new tab, so people always read the live page rather than a copy rendered inside admin.
 */
export const CONCEPTS_WIKI_URL = "https://tech.helloally.ai/#/wiki/platform/concepts.md";

/** The header icon. Every Roadmap role — Idea, Builder, Owner — has it. */
export const ConceptsButton: React.FC = () => {
  const copy = en.roadmapV2Tools.concepts;
  return (
    <Tooltip label={copy.tooltip} align="bottom-right">
      <a
        href={CONCEPTS_WIKI_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={copy.button}
        className="inline-flex h-8 w-8 items-center justify-center rounded text-typography-600 hover:bg-neutral-100 hover:text-typography-900"
      >
        <Book size={16} aria-hidden />
      </a>
    </Tooltip>
  );
};
