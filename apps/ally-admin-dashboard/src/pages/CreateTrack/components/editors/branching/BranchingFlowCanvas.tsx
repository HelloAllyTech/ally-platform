import { FC, memo, useEffect, useMemo } from "react";

import {
  Background,
  Controls,
  Edge,
  EdgeChange,
  Handle,
  MarkerType,
  Node,
  NodeChange,
  NodeProps,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { Tooltip } from "@ally-ui-mono/ui-shared";
import { BranchingOutcomeTone, BranchingScenarioContent } from "@types";

import {
  addStepBlockedReason,
  endingScore,
  isEnding,
  layoutBranching,
} from "../../../branchingScenario";

const OUTCOME_LABEL: Record<BranchingOutcomeTone, string> = {
  POSITIVE: "Positive",
  MIXED: "Mixed",
  NEGATIVE: "Negative",
};

const OUTCOME_CLASS: Record<BranchingOutcomeTone, string> = {
  POSITIVE: "border-success-400 bg-success-50 text-success-600",
  MIXED: "border-warning-300 bg-warning-50 text-warning-600",
  NEGATIVE: "border-destructive-400 bg-destructive-50 text-destructive-600",
};

const EDGE_LABEL_MAX = 28;

const truncate = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;

interface SceneNodeData extends Record<string, unknown> {
  label: string;
  isStart: boolean;
  ending: boolean;
  outcome?: BranchingOutcomeTone;
  score: number;
  choiceCount: number;
  hasImage: boolean;
  hasProblem: boolean;
  unreachable: boolean;
  /** Why '+' is off, or null when it works. */
  addBlocked: string | null;
  onAdd: () => void;
}

type SceneFlowNode = Node<SceneNodeData, "scene">;

const SceneNode = memo(({ data, selected }: NodeProps<SceneFlowNode>) => {
  const tone = data.ending
    ? data.outcome
      ? OUTCOME_CLASS[data.outcome]
      : "border-border-light bg-secondary-50 text-typography-700"
    : "border-border-light bg-white text-typography-900";
  const outline = data.hasProblem
    ? "ring-2 ring-destructive-500"
    : selected
      ? "ring-2 ring-primary-400"
      : "";
  const addLabel = data.ending ? "Turn into a decision" : "Add a choice and a new scene";

  return (
    <div className="relative w-52">
      <div
        className={`border px-3 py-2 shadow-sm ${data.ending ? "rounded-full" : "rounded-md"} ${tone} ${outline} ${
          data.unreachable ? "border-dashed" : ""
        }`}
      >
        <Handle type="target" position={Position.Left} className="!h-2 !w-2 !bg-typography-400" />
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-medium" title={data.label}>
            {data.label}
          </span>
          {data.hasProblem && (
            <span
              className="h-2 w-2 shrink-0 rounded-full bg-destructive-500"
              role="img"
              aria-label="Needs attention"
            />
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-1.5 text-xs opacity-80">
          {data.isStart && <span className="font-semibold text-primary-600">Start</span>}
          {data.ending ? (
            <span>
              {data.outcome ? OUTCOME_LABEL[data.outcome] : "Ending"} · {data.score}
            </span>
          ) : (
            <span>{data.choiceCount} choices</span>
          )}
          {data.hasImage && <span aria-label="Has an image">Image</span>}
          {data.unreachable && (
            <span className="font-semibold text-destructive-500">Not reachable</span>
          )}
        </div>
        {!data.ending && (
          <Handle
            type="source"
            position={Position.Right}
            className="!h-2.5 !w-2.5 !bg-primary-500"
          />
        )}
      </div>
      <Tooltip label={data.addBlocked ?? addLabel} align="top">
        <button
          type="button"
          aria-label={addLabel}
          aria-disabled={data.addBlocked !== null}
          onClick={event => {
            event.stopPropagation();
            if (!data.addBlocked) data.onAdd();
          }}
          className={`nodrag nopan absolute -right-9 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full border text-sm leading-none ${
            data.addBlocked
              ? "cursor-not-allowed border-border-light bg-secondary-50 text-typography-400"
              : "cursor-pointer border-primary-500 bg-white text-primary-600 hover:bg-primary-50"
          }`}
        >
          +
        </button>
      </Tooltip>
    </div>
  );
});
SceneNode.displayName = "SceneNode";

const nodeTypes = { scene: SceneNode };

/** Re-frames the chart when scenes are added or removed (not on every keystroke). */
const FitOnResize: FC<{ count: number }> = ({ count }) => {
  const { fitView } = useReactFlow();
  useEffect(() => {
    const frame = requestAnimationFrame(() => fitView({ duration: 200, maxZoom: 1 }));
    return () => cancelAnimationFrame(frame);
  }, [count, fitView]);
  return null;
};

interface BranchingFlowCanvasProps {
  content: BranchingScenarioContent;
  selectedNodeId: string;
  selectedEdgeId: string | null;
  /** Scenes with a validation problem, and scenes the start can't reach. */
  problemNodeIds: Set<string>;
  unreachableIds: Set<string>;
  sceneLabel: (nodeId: string) => string;
  onSelectNode: (nodeId: string) => void;
  onSelectEdge: (edgeId: string | null) => void;
  onAddStep: (nodeId: string) => void;
  onConnect: (sourceId: string, targetId: string) => void;
  onDeleteEdge: (nodeId: string, choiceId: string) => void;
}

/** Edge ids are `<scene id>|<choice id>`; uuids never contain the separator. */
export const edgeIdFor = (nodeId: string, choiceId: string) => `${nodeId}|${choiceId}`;

/** The scenes as a left-to-right flow chart. Layout is automatic, so scenes are not draggable. */
export const BranchingFlowCanvas: FC<BranchingFlowCanvasProps> = ({
  content,
  selectedNodeId,
  selectedEdgeId,
  problemNodeIds,
  unreachableIds,
  sceneLabel,
  onSelectNode,
  onSelectEdge,
  onAddStep,
  onConnect,
  onDeleteEdge,
}) => {
  const positions = useMemo(() => layoutBranching(content), [content]);

  const nodes = useMemo<SceneFlowNode[]>(
    () =>
      content.nodes.map(node => ({
        id: node.id,
        type: "scene",
        position: positions.get(node.id) ?? { x: 0, y: 0 },
        draggable: false,
        selected: node.id === selectedNodeId,
        data: {
          label: sceneLabel(node.id),
          isStart: node.id === content.startNodeId,
          ending: isEnding(node),
          outcome: node.outcome,
          score: endingScore(node),
          choiceCount: node.choices?.length ?? 0,
          hasImage: Boolean(node.image),
          hasProblem: problemNodeIds.has(node.id),
          unreachable: unreachableIds.has(node.id),
          addBlocked: addStepBlockedReason(content, node.id),
          onAdd: () => onAddStep(node.id),
        },
      })),
    [content, positions, selectedNodeId, problemNodeIds, unreachableIds, sceneLabel, onAddStep],
  );

  const edges = useMemo<Edge[]>(() => {
    const ids = new Set(content.nodes.map(node => node.id));
    return content.nodes.flatMap(node =>
      (node.choices ?? [])
        .filter(choice => ids.has(choice.nextNodeId))
        .map(choice => {
          const id = edgeIdFor(node.id, choice.id);
          return {
            id,
            source: node.id,
            target: choice.nextNodeId,
            type: "smoothstep",
            label: choice.text.trim() ? truncate(choice.text.trim(), EDGE_LABEL_MAX) : undefined,
            selected: id === selectedEdgeId,
            markerEnd: { type: MarkerType.ArrowClosed },
            labelStyle: { fontSize: 11 },
            labelBgPadding: [4, 2] as [number, number],
            labelBgBorderRadius: 4,
          };
        }),
    );
  }, [content, selectedEdgeId]);

  // Selection (mouse and keyboard) arrives as change events; the chart is fully controlled.
  const handleNodesChange = (changes: NodeChange[]) => {
    for (const change of changes) {
      if (change.type === "select" && change.selected) onSelectNode(change.id);
    }
  };
  const handleEdgesChange = (changes: EdgeChange[]) => {
    for (const change of changes) {
      if (change.type !== "select") continue;
      if (change.selected) onSelectEdge(change.id);
      else if (change.id === selectedEdgeId) onSelectEdge(null);
    }
  };

  return (
    <div
      role="region"
      aria-label="Scenario flow chart. Select a scene to edit it; the list view below is a keyboard alternative."
      className="h-[520px] w-full rounded-md border border-border-light bg-secondary-50"
    >
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          onConnect={connection => {
            if (connection.source && connection.target) {
              onConnect(connection.source, connection.target);
            }
          }}
          isValidConnection={connection => connection.source !== connection.target}
          onEdgesDelete={deleted => {
            for (const edge of deleted) {
              const [nodeId, choiceId] = edge.id.split("|");
              onDeleteEdge(nodeId, choiceId);
            }
          }}
          // Scenes are removed from the form, never with the keyboard on the canvas.
          onBeforeDelete={async ({ edges: doomed }) => ({ nodes: [], edges: doomed })}
          deleteKeyCode={["Delete", "Backspace"]}
          nodesDraggable={false}
          fitView
          fitViewOptions={{ maxZoom: 1 }}
          minZoom={0.2}
          maxZoom={1.5}
          defaultEdgeOptions={{ type: "smoothstep" }}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={20} />
          <Controls showInteractive={false} />
          <FitOnResize count={content.nodes.length} />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
};
