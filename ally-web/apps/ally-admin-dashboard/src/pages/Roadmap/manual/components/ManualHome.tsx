import React, { useMemo } from "react";

import { motion } from "framer-motion";
import { Link } from "react-router-dom";

import { en } from "@constants";

import { ManualMessage } from "./StateViews";
import {
  fadeUpVariants,
  listStaggerDelay,
  motionTransition,
  useReducedMotionPreference,
} from "../../../../motion";
import { useManualData } from "../hooks/useManualData";
import { buildTree } from "../utils/tree";
import { manualHref } from "../utils/wikilinks";

/** The manual's front page: what it is, then its sections as cards. */
export const ManualHome: React.FC = () => {
  const copy = en.productManual;
  const reduced = useReducedMotionPreference();
  const { pages } = useManualData();
  const tree = useMemo(() => buildTree(pages), [pages]);
  if (tree.length === 0) {
    return <ManualMessage title={copy.emptyManual} hint={copy.emptyManualHint} />;
  }
  const count = (node: (typeof tree)[number]): number =>
    node.children.reduce((sum, child) => sum + (child.kind === "page" ? 1 : 0) + count(child), 0);
  return (
    <div className="flex flex-col gap-8">
      <motion.header
        variants={fadeUpVariants(reduced, 6)}
        initial="initial"
        animate="animate"
        transition={motionTransition("moderate", "expressive", reduced)}
      >
        <h1 className="m-0 text-[2rem] font-semibold leading-tight text-typography-900">
          {copy.title}
        </h1>
        <p className="m-0 mt-2 max-w-[60ch] text-lg leading-relaxed text-typography-700">
          {copy.intro}
        </p>
      </motion.header>
      <section aria-labelledby="manual-home-sections" className="flex flex-col gap-3">
        <h2 id="manual-home-sections" className="sr-only">
          {copy.home.sections}
        </h2>
        <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 md:grid-cols-2">
          {tree.map((node, index) => (
            <motion.li
              key={node.slug}
              variants={fadeUpVariants(reduced, 6)}
              initial="initial"
              animate="animate"
              transition={{
                ...motionTransition("moderate", "expressive", reduced),
                delay: listStaggerDelay(index + 1, reduced),
              }}
            >
              <Link
                to={manualHref(node.slug)}
                className="flex h-full flex-col gap-1.5 border border-border-light bg-white p-4 transition-colors duration-100 hover:border-primary-500"
              >
                <span className="text-base font-semibold text-typography-900">{node.title}</span>
                {node.summary && (
                  <span className="text-sm leading-relaxed text-typography-600">
                    {node.summary}
                  </span>
                )}
                {node.kind === "section" && (
                  <span className="mt-auto pt-2 text-xs text-typography-500">
                    {copy.home.pages(count(node))}
                  </span>
                )}
              </Link>
            </motion.li>
          ))}
        </ul>
      </section>
    </div>
  );
};
