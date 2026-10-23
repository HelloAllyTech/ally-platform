import { FC, useState } from "react";

import { Close } from "@assets";
import { BranchingOutcomeTone, BranchingScenarioContent } from "@types";

import { isEnding, runResult } from "../../../branchingScenario";

interface BranchingPreviewModalProps {
  content: BranchingScenarioContent;
  onClose: () => void;
}

const OUTCOME_LABEL: Record<BranchingOutcomeTone, string> = {
  POSITIVE: "Positive ending",
  MIXED: "Mixed ending",
  NEGATIVE: "Negative ending",
};

const OUTCOME_BADGE: Record<BranchingOutcomeTone, string> = {
  POSITIVE: "bg-green-50 text-green-700",
  MIXED: "bg-amber-50 text-amber-700",
  NEGATIVE: "bg-red-50 text-red-700",
};

/**
 * Runs the scenario as the learner will meet it — scene, choice, next scene,
 * ending with score and pass status — against the form as it stands right
 * now, saved or not. Nothing is recorded.
 */
export const BranchingPreviewModal: FC<BranchingPreviewModalProps> = ({ content, onClose }) => {
  const [currentId, setCurrentId] = useState(content.startNodeId);
  const node = content.nodes.find(candidate => candidate.id === currentId);
  const result = node && isEnding(node) ? runResult(content, node) : null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black bg-opacity-50"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-label="Scenario preview"
        className="relative z-10 w-[calc(100%-2rem)] max-w-[560px] max-h-[85vh] bg-white rounded-md shadow-xl flex flex-col"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-light">
          <span className="text-sm font-semibold text-typography-900">Preview</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-typography-500 hover:text-typography-700"
          >
            <Close className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
          {!node ? (
            <p className="text-sm text-typography-500">Pick a first scene to preview.</p>
          ) : (
            <>
              {currentId === content.startNodeId && content.intro?.trim() && (
                <p className="rounded-md bg-secondary-50 px-3 py-2 text-sm text-typography-700">
                  {content.intro}
                </p>
              )}
              {node.title?.trim() && (
                <p className="text-base font-semibold text-typography-900">{node.title}</p>
              )}
              {node.image && (
                <img
                  src={node.image.url}
                  alt={node.image.alt || ""}
                  className="max-h-[220px] w-auto self-start rounded-md object-contain"
                />
              )}
              <p className="whitespace-pre-wrap text-sm text-typography-800">
                {node.text || "(This scene has no text yet.)"}
              </p>

              {result ? (
                <div className="flex flex-col gap-3 border-t border-border-light pt-4">
                  <div className="flex flex-wrap items-center gap-2">
                    {node.outcome && (
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-medium ${OUTCOME_BADGE[node.outcome]}`}
                      >
                        {OUTCOME_LABEL[node.outcome]}
                      </span>
                    )}
                    <span className="text-sm font-medium text-typography-900">
                      Score {result.score}
                    </span>
                    {result.passed !== null && (
                      <span
                        className={`text-sm font-medium ${
                          result.passed ? "text-green-700" : "text-destructive-500"
                        }`}
                      >
                        {result.passed
                          ? "Passed"
                          : `Not passed — needs ${content.settings?.passScore}`}
                      </span>
                    )}
                  </div>
                  {node.takeaway?.trim() && (
                    <p className="rounded-md bg-secondary-50 px-3 py-2 text-sm text-typography-700">
                      {node.takeaway}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => setCurrentId(content.startNodeId)}
                    className="w-fit rounded-md border border-border-light px-3 py-1.5 text-sm text-typography-800 hover:bg-secondary-50"
                  >
                    Start again
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {(node.choices ?? []).map(choice => {
                    const target = content.nodes.some(n => n.id === choice.nextNodeId);
                    return (
                      <button
                        key={choice.id}
                        type="button"
                        disabled={!target}
                        onClick={() => setCurrentId(choice.nextNodeId)}
                        className="text-left rounded-md border border-border-light px-3 py-2 text-sm text-typography-900 hover:bg-secondary-50 disabled:opacity-50"
                      >
                        {choice.text || "(empty choice)"}
                        {!target && " — doesn't lead anywhere yet"}
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
