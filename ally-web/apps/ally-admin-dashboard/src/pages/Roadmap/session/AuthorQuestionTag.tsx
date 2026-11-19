import React from "react";

import { en } from "@constants";
import type { BuilderQuestionEvent, RoadmapItemDetail } from "@types";

/**
 * On a question the planning agent addressed to the idea's author (a question about the problem or
 * the people who have it; idea-to-plan audit rec 10, [FP-2104]): says whose question it is. Anyone
 * may still answer. Nothing for any other question.
 */
export const AuthorQuestionTag: React.FC<{
  question: Pick<BuilderQuestionEvent, "forAuthor">;
  item: Pick<RoadmapItemDetail, "author">;
}> = ({ question, item }) => {
  if (!question.forAuthor) return null;
  return (
    <span className="self-start rounded bg-primary-50 px-1.5 py-0.5 text-xs text-primary-700">
      {en.roadmapIdeaToPlan.forAuthor(item.author?.name ?? "")}
    </span>
  );
};
