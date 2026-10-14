import { FC } from "react";

import { RoadmapCard, useGetPublicRoadmapQuery } from "@api";

import { BlogFooter } from "./BlogFooter";
import { BlogHeader } from "./BlogHeader";
import { ROADMAP_DESCRIPTION, ROADMAP_TITLE } from "./blogMeta";
import {
  CategoryInfo,
  ROADMAP_CATEGORIES,
  ROADMAP_HEADLINE,
  ROADMAP_INTRO,
  ROADMAP_STAGES,
  RoadmapGrid,
  formatRoadmapMonth,
  groupIntoGrid,
  stageLevel,
} from "./roadmapContent";
import { usePageMeta } from "./usePageMeta";

// Wider than the changelog's column: five card columns plus the category
// labels need it, and the header and footer are widened to match.
const CONTAINER = "max-w-7xl";

/**
 * One grid shared by the stage key and every category row, so a stage's
 * column lines up from the key down through both categories. Below `lg` it is
 * not a grid at all: each category becomes a list grouped by stage. At `lg`
 * the category label spans the row above its five cells; at `xl` it moves into
 * a column of its own, as on the printed roadmap.
 */
const ROW = "lg:grid lg:grid-cols-5 lg:gap-4 xl:grid-cols-[11rem_repeat(5,minmax(0,1fr))] xl:gap-5";

/** Spans the five stage columns at `lg`; a single column once labels sit beside the cells. */
const LABEL_CELL = "lg:col-span-5 xl:col-span-1";

const ACCENT_TEXT = "text-[#B34F2C]";

const MaturityDots: FC<{ level: number }> = ({ level }) => (
  <span aria-hidden="true" className="flex gap-1">
    {ROADMAP_STAGES.map((stage, index) => (
      <span
        key={stage.id}
        className={`h-2 w-2 rounded-full ${
          index < level ? "bg-[#D76F4C]" : "border border-gray-400"
        }`}
      />
    ))}
  </span>
);

const StageKey: FC = () => (
  <section aria-labelledby="roadmap-stages" className={`${ROW} mt-10 sm:mt-14`}>
    <h2
      id="roadmap-stages"
      className={`${LABEL_CELL} mb-4 text-xs italic text-gray-600 lg:mb-0 xl:self-end`}
    >
      <span className="xl:hidden">Maturity, least to most</span>
      <span className="hidden xl:inline">Maturity →</span>
    </h2>
    <ol className="contents">
      {ROADMAP_STAGES.map((stage, index) => (
        <li key={stage.id} className="mb-4 flex gap-3 lg:mb-0 lg:block">
          <span className="pt-2 lg:pt-0">
            <MaturityDots level={index + 1} />
          </span>
          <span>
            <span className="block text-xl lg:mt-3 lg:text-2xl">{stage.label}</span>
            <span className="mt-1 block text-sm leading-snug text-gray-700">
              {stage.description}
            </span>
          </span>
        </li>
      ))}
    </ol>
  </section>
);

const Card: FC<{ card: RoadmapCard }> = ({ card }) => (
  <li className="rounded-lg border border-gray-900/10 bg-white px-4 py-3.5">
    <h4 className="text-lg leading-snug text-gray-900">{card.title}</h4>
    <p className="mt-1.5 text-sm leading-relaxed text-gray-700">{card.description}</p>
    {card.note && <p className={`mt-2 text-xs italic ${ACCENT_TEXT}`}>{card.note}</p>}
  </li>
);

const CategoryRow: FC<{ category: CategoryInfo; number: number; grid: RoadmapGrid }> = ({
  category,
  number,
  grid,
}) => {
  const cells = grid[category.id];
  const isEmpty = ROADMAP_STAGES.every(stage => cells[stage.id].length === 0);
  const headingId = `roadmap-${category.id}`;

  return (
    <section
      aria-labelledby={headingId}
      className={`${ROW} mt-8 border-t border-gray-900/10 pt-8 lg:mt-10 lg:pt-10`}
    >
      <div className={`${LABEL_CELL} mb-6 lg:mb-2 xl:mb-0`}>
        <p className={`text-sm italic ${ACCENT_TEXT}`}>{String(number).padStart(2, "0")}</p>
        <h2 id={headingId} className="mt-1 text-4xl leading-tight">
          {category.label}
        </h2>
        <p className="mt-2 max-w-sm text-sm leading-relaxed text-gray-700">
          {category.description}
        </p>
      </div>

      {isEmpty ? (
        <p className="text-gray-700 lg:col-span-5">Nothing here yet.</p>
      ) : (
        ROADMAP_STAGES.map(stage => {
          const cards = cells[stage.id];
          // An empty cell keeps its column on the grid and is skipped in the
          // stacked layout, where it would be a heading with nothing under it.
          if (cards.length === 0) {
            return <div key={stage.id} aria-hidden="true" className="hidden lg:block" />;
          }
          return (
            <div key={stage.id} className="mb-6 lg:mb-0">
              {/* Visible only in the stacked layout; on the grid the stage key's
                  column headings say it, and screen readers still get it here. */}
              <h3 className="mb-3 flex items-center gap-3 lg:sr-only">
                <MaturityDots level={stageLevel(stage.id)} />
                <span className="text-lg">{stage.label}</span>
              </h3>
              <ul className="flex flex-col gap-3">
                {cards.map(card => (
                  <Card key={card.id} card={card} />
                ))}
              </ul>
            </div>
          );
        })
      )}
    </section>
  );
};

/**
 * The public product roadmap: what Ally is building, by the job it supports
 * (prepare, perform) and how mature it is (idea → stable). The frame and its
 * copy are fixed here; the cards come from ally-be and are edited from the
 * admin console's Settings → Roadmap tab, live on save.
 */
export const Roadmap: FC = () => {
  usePageMeta({ title: ROADMAP_TITLE, description: ROADMAP_DESCRIPTION, url: "/blog/roadmap" });

  const { data, isLoading, isError } = useGetPublicRoadmapQuery();
  const cards = data?.items ?? [];
  const grid = groupIntoGrid(cards);

  return (
    <div className="blog-serif flex min-h-dvh flex-col bg-[#FAF9F5] text-[#29261f]">
      <BlogHeader containerClassName={CONTAINER} />
      <main className={`mx-auto w-full ${CONTAINER} flex-1 px-4 py-10 sm:px-6 sm:py-14`}>
        <h1 className="text-4xl leading-tight sm:text-5xl lg:text-6xl">{ROADMAP_HEADLINE}</h1>
        <div className="mt-4 flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <p className="max-w-2xl text-base leading-relaxed text-gray-700 sm:text-lg">
            {ROADMAP_INTRO}
          </p>
          {data?.updatedAt && cards.length > 0 && (
            <p className="shrink-0 sm:pt-1 sm:text-right">
              <time dateTime={data.updatedAt} className="block text-xl">
                {formatRoadmapMonth(data.updatedAt)}
              </time>
              <span className="mt-1 block text-sm italic text-gray-600">Updated quarterly</span>
            </p>
          )}
        </div>

        {isLoading ? (
          <p className="mt-10 text-gray-700">Loading…</p>
        ) : isError ? (
          <p className="mt-10 text-gray-700">
            Something went wrong loading the roadmap. Please try again later.
          </p>
        ) : cards.length === 0 ? (
          <p className="mt-10 text-gray-700">Nothing on the roadmap yet. Check back soon!</p>
        ) : (
          <>
            <StageKey />
            {ROADMAP_CATEGORIES.map((category, index) => (
              <CategoryRow key={category.id} category={category} number={index + 1} grid={grid} />
            ))}
          </>
        )}
      </main>
      <BlogFooter containerClassName={CONTAINER} />
    </div>
  );
};
