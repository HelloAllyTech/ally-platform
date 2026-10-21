import { FC, useMemo, useRef, useState } from "react";

import { useFormContext, useWatch } from "react-hook-form";
import { toast } from "sonner";

import { TextArea, Tooltip } from "@ally-ui-mono/ui-shared";
import { TooltipIcon, Trash } from "@assets";
import { Button } from "@components";
import { ButtonVariant } from "@components/types";
import {
  MAX_BRANCHING_CHOICE_TEXT,
  MAX_BRANCHING_CHOICES,
  MAX_BRANCHING_NODE_TEXT,
  MAX_BRANCHING_NODES,
  MAX_BRANCHING_TAKEAWAY,
  MAX_BRANCHING_TITLE,
  MAX_QUESTION_IMAGE_BYTES,
  MAX_QUESTION_MEDIA_ALT_LENGTH,
  MIN_BRANCHING_CHOICES,
  QUESTION_IMAGE_CONTENT_TYPES,
} from "@constants";
import {
  BranchingChoice,
  BranchingNode,
  BranchingOutcomeTone,
  BranchingScenarioContent,
  TrackFormValues,
  TrackItemType,
} from "@types";

import {
  addStep,
  connectChoice,
  createEnding,
  endingScore,
  isEnding,
  OUTCOME_DEFAULT_SCORE,
  reachableNodeIds,
  removeChoiceFromNode,
  validateBranching,
} from "../../../branchingScenario";
import { useTrackMediaUpload } from "../../../useTrackMediaUpload";
import { ItemEditorFrame } from "../ItemEditorFrame";
import { BranchingFlowCanvas } from "./BranchingFlowCanvas";
import { BranchingPreviewModal } from "./BranchingPreviewModal";

interface BranchingScenarioItemEditorProps {
  sectionIndex: number;
  itemIndex: number;
  onDelete: () => void;
}

const headingClass = "text-sm font-semibold text-typography-900";
const subClass = "text-xs text-typography-500";
const labelClass = "text-xs font-medium text-typography-700";
const inputClass =
  "border border-border-light rounded-md px-2 py-1 text-sm outline-none focus:border-primary-400 disabled:opacity-60";

const NEW_SCENE = "__new__";

const OUTCOME_OPTIONS: { value: BranchingOutcomeTone; label: string }[] = [
  { value: "POSITIVE", label: "Positive" },
  { value: "MIXED", label: "Mixed" },
  { value: "NEGATIVE", label: "Negative" },
];

const HelpTip: FC<{ label: string }> = ({ label }) => (
  <Tooltip label={label} align="top">
    <button type="button" className="cursor-pointer inline-flex items-center">
      <TooltipIcon />
    </button>
  </Tooltip>
);

/**
 * Authoring for the Branching scenario component: a graph of scenes the learner
 * walks by making choices. A flow chart (left) shows every scene and choice and
 * is where branches are added and re-joined; a collapsed list view is the
 * keyboard alternative; the form (right) edits the selected scene. A scene with no choices is an ending, so "making an ending" and
 * "stopping asking a question" are the same switch.
 */
export const BranchingScenarioItemEditor: FC<BranchingScenarioItemEditorProps> = ({
  sectionIndex,
  itemIndex,
  onDelete,
}) => {
  const { control, setValue } = useFormContext<TrackFormValues>();
  const base = `sections.${sectionIndex}.items.${itemIndex}.branching` as const;
  const content = useWatch({ control, name: base }) as BranchingScenarioContent | undefined;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [showList, setShowList] = useState(false);

  const problems = useMemo(() => (content ? validateBranching(content) : []), [content]);

  if (!content) {
    return (
      <ItemEditorFrame
        sectionIndex={sectionIndex}
        itemIndex={itemIndex}
        type={TrackItemType.BRANCHING_SCENARIO}
        onDelete={onDelete}
      >
        <p className={subClass}>This scenario has no content yet.</p>
      </ItemEditorFrame>
    );
  }

  const patch = (next: Partial<BranchingScenarioContent>) =>
    setValue(base, { ...content, ...next }, { shouldDirty: true });

  const selected =
    content.nodes.find(node => node.id === selectedId) ??
    content.nodes.find(node => node.id === content.startNodeId) ??
    content.nodes[0];

  const indexOfNode = (node: BranchingNode) => content.nodes.indexOf(node);
  const sceneLabel = (node: BranchingNode) =>
    node.title?.trim() || `Scene ${indexOfNode(node) + 1}`;
  const problemNodeIds = new Set(problems.map(problem => problem.nodeId));

  const updateNode = (id: string, next: Partial<BranchingNode>) =>
    patch({ nodes: content.nodes.map(node => (node.id === id ? { ...node, ...next } : node)) });

  const addScene = () => {
    const scene = createEnding();
    patch({ nodes: [...content.nodes, scene] });
    setSelectedId(scene.id);
  };

  const removeScene = (id: string) => {
    // Choices that led here are kept but left without a destination, so the
    // trainer is told which ones to re-point rather than losing their wording.
    patch({
      nodes: content.nodes
        .filter(node => node.id !== id)
        .map(node =>
          node.choices?.some(choice => choice.nextNodeId === id)
            ? {
                ...node,
                choices: node.choices.map(choice =>
                  choice.nextNodeId === id ? { ...choice, nextNodeId: "" } : choice,
                ),
              }
            : node,
        ),
    });
    setSelectedId(content.startNodeId === id ? null : content.startNodeId);
  };

  const setSettings = (next: Partial<NonNullable<BranchingScenarioContent["settings"]>>) =>
    patch({ settings: { ...content.settings, ...next } });

  const ending = isEnding(selected);

  const makeEnding = () => updateNode(selected.id, { choices: undefined });

  const makeDecision = () => {
    const choices: BranchingChoice[] = Array.from({ length: MIN_BRANCHING_CHOICES }, () => ({
      id: crypto.randomUUID(),
      text: "",
      nextNodeId: "",
    }));
    // Outcome, score and takeaway belong to endings only, so they are cleared here.
    updateNode(selected.id, { choices, outcome: undefined, score: undefined, takeaway: undefined });
  };

  const setChoice = (choiceId: string, next: Partial<BranchingChoice>) =>
    updateNode(selected.id, {
      choices: (selected.choices ?? []).map(choice =>
        choice.id === choiceId ? { ...choice, ...next } : choice,
      ),
    });

  const setDestination = (choiceId: string, value: string) => {
    if (value !== NEW_SCENE) {
      setChoice(choiceId, { nextNodeId: value });
      return;
    }
    // One write for both the new scene and the choice that points at it.
    const scene = createEnding();
    patch({
      nodes: [
        ...content.nodes.map(node =>
          node.id === selected.id
            ? {
                ...node,
                choices: (node.choices ?? []).map(choice =>
                  choice.id === choiceId ? { ...choice, nextNodeId: scene.id } : choice,
                ),
              }
            : node,
        ),
        scene,
      ],
    });
  };

  const addChoice = () =>
    updateNode(selected.id, {
      choices: [...(selected.choices ?? []), { id: crypto.randomUUID(), text: "", nextNodeId: "" }],
    });

  const removeChoice = (choiceId: string) =>
    updateNode(selected.id, {
      choices: (selected.choices ?? []).filter(choice => choice.id !== choiceId),
    });

  const setOutcome = (outcome: BranchingOutcomeTone) =>
    updateNode(selected.id, { outcome, score: OUTCOME_DEFAULT_SCORE[outcome] });

  const reachable = reachableNodeIds(content);
  const unreachableIds = new Set(
    content.nodes.filter(node => !reachable.has(node.id)).map(node => node.id),
  );

  // Canvas edits: each is one pure content change, or a toast when it can't be done.
  const handleAddStep = (nodeId: string) => {
    const result = addStep(content, nodeId);
    if (!result) return;
    patch(result.content);
    setSelectedId(result.newNodeId);
    setSelectedEdgeId(null);
  };

  const handleConnect = (sourceId: string, targetId: string) => {
    const next = connectChoice(content, sourceId, targetId);
    if (next) patch(next);
    else
      toast.error(
        "That connection isn't possible: scenes allow up to 6 choices, and each choice leads somewhere different.",
      );
  };

  const handleDeleteEdge = (nodeId: string, choiceId: string) => {
    const next = removeChoiceFromNode(content, nodeId, choiceId);
    if (next) patch(next);
    else
      toast.error(
        "A scene needs at least one choice. To end the scene here, switch it to an ending in the form.",
      );
    setSelectedEdgeId(null);
  };

  const selectedProblems = problems.filter(problem => problem.nodeId === selected.id);
  const generalProblems = problems.filter(problem => problem.nodeId === null);
  const passScore = content.settings?.passScore ?? 0;
  const canAddScene = content.nodes.length < MAX_BRANCHING_NODES;

  return (
    <ItemEditorFrame
      sectionIndex={sectionIndex}
      itemIndex={itemIndex}
      type={TrackItemType.BRANCHING_SCENARIO}
      onDelete={onDelete}
    >
      {/* ---- Completion gate ---- */}
      <div className="rounded-md border border-border-light bg-secondary-50 px-4 py-3 flex flex-wrap items-end gap-5">
        <div className="flex flex-col gap-0.5 mr-auto">
          <span className="inline-flex items-center gap-1 text-sm font-semibold text-typography-900">
            Completion gate
            <HelpTip label="Each ending has a score. The learner completes this component by reaching an ending that scores at least the pass mark; otherwise they can try again. Set the pass mark to 0 to complete on any ending." />
          </span>
          <span className={subClass}>
            {passScore > 0
              ? `Learners must reach an ending scoring ${passScore} or more.`
              : "No pass mark — any ending completes it."}
          </span>
        </div>
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Pass mark (0–100)</span>
          <input
            type="number"
            min={0}
            max={100}
            value={content.settings?.passScore ?? 0}
            onChange={event => setSettings({ passScore: Number(event.target.value) })}
            onWheel={event => event.currentTarget.blur()}
            className={`${inputClass} w-24`}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Attempts (blank = unlimited)</span>
          <input
            type="number"
            min={1}
            value={content.settings?.maxAttempts ?? ""}
            onChange={event =>
              setSettings({
                maxAttempts: event.target.value === "" ? null : Number(event.target.value),
              })
            }
            onWheel={event => event.currentTarget.blur()}
            className={`${inputClass} w-24`}
          />
        </label>
        <Button
          variant={ButtonVariant.SECONDARY}
          className="!h-9 w-fit text-sm"
          onClick={() => setShowPreview(true)}
        >
          Preview
        </Button>
      </div>

      <TextArea
        id={`${base}.intro`}
        labelText="Introduction (optional) — shown above the first scene"
        value={content.intro ?? ""}
        onChange={event => patch({ intro: event.target.value })}
        rows={2}
        placeholder="e.g. A caller has just told you she hasn't slept in days."
        className="w-full"
      />

      {generalProblems.length > 0 && (
        <ul className="rounded-md bg-red-50 px-3 py-2 text-xs text-destructive-500 list-disc pl-6">
          {generalProblems.map(problem => (
            <li key={problem.message}>{problem.message}</li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        {/* ---- Flow chart ---- */}
        <div className="flex flex-col gap-2 min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1">
              <p className={headingClass}>Scenes</p>
              <HelpTip label="Click a scene to edit it. Press + on a scene to add a choice and the scene it leads to. Drag from a scene's right-hand dot onto another scene to make a choice lead there, so branches can join up again. Click an arrow and press Delete to remove that choice." />
            </span>
            <span className={subClass}>
              {content.nodes.length} of {MAX_BRANCHING_NODES} scenes
            </span>
          </div>
          <BranchingFlowCanvas
            content={content}
            selectedNodeId={selected.id}
            selectedEdgeId={selectedEdgeId}
            problemNodeIds={problemNodeIds}
            unreachableIds={unreachableIds}
            sceneLabel={nodeId => sceneLabel(content.nodes.find(node => node.id === nodeId)!)}
            onSelectNode={nodeId => {
              setSelectedId(nodeId);
              setSelectedEdgeId(null);
            }}
            onSelectEdge={setSelectedEdgeId}
            onAddStep={handleAddStep}
            onConnect={handleConnect}
            onDeleteEdge={handleDeleteEdge}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant={ButtonVariant.SECONDARY}
              className="!h-9 w-fit text-sm"
              onClick={addScene}
              disabled={!canAddScene}
            >
              Add scene
            </Button>
            {selectedEdgeId && (
              <button
                type="button"
                onClick={() => {
                  const [nodeId, choiceId] = selectedEdgeId.split("|");
                  handleDeleteEdge(nodeId, choiceId);
                }}
                className="inline-flex items-center gap-1 text-xs text-destructive-500 hover:text-destructive-600"
              >
                <Trash className="w-3.5 h-3.5" />
                Remove selected choice
              </button>
            )}
            <button
              type="button"
              aria-expanded={showList}
              onClick={() => setShowList(open => !open)}
              className="ml-auto text-xs text-primary-600 hover:underline"
            >
              {showList ? "Hide list view" : "List view"}
            </button>
          </div>

          {/* ---- Scene list: the keyboard / screen-reader alternative to the chart ---- */}
          {showList && (
            <div className="flex max-h-64 flex-col gap-1 overflow-y-auto">
              {content.nodes.map(node => {
                const isStart = node.id === content.startNodeId;
                const nodeEnding = isEnding(node);
                return (
                  <button
                    key={node.id}
                    type="button"
                    onClick={() => setSelectedId(node.id)}
                    aria-current={node.id === selected.id}
                    className={`text-left rounded-md border px-3 py-2 transition-colors ${
                      node.id === selected.id
                        ? "border-primary-400 bg-primary-50"
                        : "border-border-light hover:bg-secondary-50"
                    }`}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-typography-900">
                        {sceneLabel(node)}
                      </span>
                      {problemNodeIds.has(node.id) && (
                        <span
                          className="h-2 w-2 shrink-0 rounded-full bg-destructive-500"
                          role="img"
                          aria-label="Needs attention"
                        />
                      )}
                    </span>
                    <span className="block text-xs text-typography-500">
                      {isStart ? "Start · " : ""}
                      {nodeEnding
                        ? `Ending · ${
                            node.outcome
                              ? OUTCOME_OPTIONS.find(o => o.value === node.outcome)?.label
                              : "No outcome"
                          } · ${endingScore(node)}`
                        : `Scene · ${node.choices?.length ?? 0} choices`}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* ---- Selected scene ---- */}
        <div className="flex flex-col gap-4 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <p className={headingClass}>{sceneLabel(selected)}</p>
            <div className="flex items-center gap-3">
              {selected.id !== content.startNodeId && (
                <button
                  type="button"
                  onClick={() => patch({ startNodeId: selected.id })}
                  className="text-xs text-primary-600 hover:underline"
                >
                  Make this the first scene
                </button>
              )}
              {selected.id !== content.startNodeId && (
                <button
                  type="button"
                  onClick={() => removeScene(selected.id)}
                  className="inline-flex items-center gap-1 text-xs text-destructive-500 hover:text-destructive-600"
                >
                  <Trash className="w-3.5 h-3.5" />
                  Delete scene
                </button>
              )}
            </div>
          </div>

          {selectedProblems.length > 0 && (
            <ul className="rounded-md bg-red-50 px-3 py-2 text-xs text-destructive-500 list-disc pl-6">
              {selectedProblems.map(problem => (
                <li key={problem.message}>{problem.message}</li>
              ))}
            </ul>
          )}

          <label className="flex flex-col gap-1">
            <span className={labelClass}>Title (optional)</span>
            <input
              type="text"
              maxLength={MAX_BRANCHING_TITLE}
              value={selected.title ?? ""}
              onChange={event => updateNode(selected.id, { title: event.target.value })}
              placeholder="e.g. The caller goes quiet"
              className={`${inputClass} w-full`}
            />
          </label>

          <div className="flex flex-col gap-1">
            <TextArea
              id={`${base}.${selected.id}.text`}
              labelText="What the learner sees and hears"
              value={selected.text}
              onChange={event => updateNode(selected.id, { text: event.target.value })}
              rows={5}
              placeholder="Describe the moment. Write what the caller says, in their words."
              className="w-full"
            />
            <span
              className={
                selected.text.length > MAX_BRANCHING_NODE_TEXT
                  ? "text-xs text-destructive-500"
                  : subClass
              }
            >
              {selected.text.length} of {MAX_BRANCHING_NODE_TEXT}
            </span>
          </div>

          <SceneImageField node={selected} onChange={image => updateNode(selected.id, { image })} />

          {/* ---- Decision or ending ---- */}
          <div className="border-t border-border-light pt-4 flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className={labelClass}>This scene</span>
              {[
                { label: "Asks the learner to choose", value: false },
                { label: "Is an ending", value: true },
              ].map(option => (
                <button
                  key={option.label}
                  type="button"
                  aria-pressed={ending === option.value}
                  onClick={() => {
                    if (ending === option.value) return;
                    if (option.value) makeEnding();
                    else makeDecision();
                  }}
                  className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                    ending === option.value
                      ? "border-primary-500 bg-primary-50 text-primary-700"
                      : "border-border-light text-typography-700 hover:bg-secondary-50"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>

            {ending ? (
              <>
                <div className="flex flex-col gap-1">
                  <span className="inline-flex items-center gap-1">
                    <span className={labelClass}>Outcome</span>
                    <HelpTip label="How the conversation turned out. It sets the badge the learner sees and prefills the score (Positive 100, Mixed 50, Negative 0). You can change the score." />
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {OUTCOME_OPTIONS.map(option => (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={selected.outcome === option.value}
                        onClick={() => setOutcome(option.value)}
                        className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                          selected.outcome === option.value
                            ? "border-primary-500 bg-primary-50 text-primary-700"
                            : "border-border-light text-typography-700 hover:bg-secondary-50"
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>

                <label className="flex flex-col gap-1">
                  <span className={labelClass}>Score (0–100)</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={endingScore(selected)}
                    onChange={event =>
                      updateNode(selected.id, { score: Number(event.target.value) })
                    }
                    onWheel={event => event.currentTarget.blur()}
                    className={`${inputClass} w-24`}
                  />
                </label>

                <div className="flex flex-col gap-1">
                  <TextArea
                    id={`${base}.${selected.id}.takeaway`}
                    labelText="Takeaway (optional) — why it went this way"
                    value={selected.takeaway ?? ""}
                    onChange={event => updateNode(selected.id, { takeaway: event.target.value })}
                    rows={3}
                    placeholder="Reflecting her feeling back gave her room to keep talking."
                    className="w-full"
                  />
                  <span
                    className={
                      (selected.takeaway ?? "").length > MAX_BRANCHING_TAKEAWAY
                        ? "text-xs text-destructive-500"
                        : subClass
                    }
                  >
                    {(selected.takeaway ?? "").length} of {MAX_BRANCHING_TAKEAWAY}
                  </span>
                </div>
              </>
            ) : (
              <div className="flex flex-col gap-3">
                <p className={subClass}>
                  {MIN_BRANCHING_CHOICES} to {MAX_BRANCHING_CHOICES} choices. Each leads to another
                  scene, or back to an earlier one.
                </p>
                {(selected.choices ?? []).map((choice, choiceIndex) => (
                  <div
                    key={choice.id}
                    className="rounded-md border border-border-light p-3 flex flex-col gap-2"
                  >
                    <div className="flex items-center justify-between">
                      <span className={labelClass}>Choice {choiceIndex + 1}</span>
                      {(selected.choices?.length ?? 0) > MIN_BRANCHING_CHOICES && (
                        <button
                          type="button"
                          onClick={() => removeChoice(choice.id)}
                          aria-label={`Remove choice ${choiceIndex + 1}`}
                          className="text-destructive-500 hover:text-destructive-600"
                        >
                          <Trash className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    <input
                      type="text"
                      aria-label={`Choice ${choiceIndex + 1} text`}
                      maxLength={MAX_BRANCHING_CHOICE_TEXT}
                      value={choice.text}
                      onChange={event => setChoice(choice.id, { text: event.target.value })}
                      placeholder="What the learner says or does"
                      className={`${inputClass} w-full`}
                    />
                    <label className="flex flex-col gap-1">
                      <span className={labelClass}>Leads to</span>
                      <select
                        value={choice.nextNodeId}
                        onChange={event => setDestination(choice.id, event.target.value)}
                        className={`${inputClass} w-full bg-white`}
                      >
                        <option value="" disabled>
                          Choose a scene…
                        </option>
                        {content.nodes
                          .filter(node => node.id !== selected.id)
                          .map(node => (
                            <option key={node.id} value={node.id}>
                              {sceneLabel(node)}
                              {isEnding(node) ? " (ending)" : ""}
                            </option>
                          ))}
                        {canAddScene && <option value={NEW_SCENE}>+ New scene</option>}
                      </select>
                    </label>
                  </div>
                ))}
                {(selected.choices?.length ?? 0) < MAX_BRANCHING_CHOICES && (
                  <Button
                    variant={ButtonVariant.SECONDARY}
                    className="!h-9 w-fit text-sm"
                    onClick={addChoice}
                  >
                    Add choice
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {showPreview && (
        <BranchingPreviewModal content={content} onClose={() => setShowPreview(false)} />
      )}
    </ItemEditorFrame>
  );
};

interface SceneImageFieldProps {
  node: BranchingNode;
  onChange: (image: BranchingNode["image"]) => void;
}

/** One optional picture per scene, uploaded through the same track-media flow as quiz question images. */
const SceneImageField: FC<SceneImageFieldProps> = ({ node, onChange }) => {
  const { upload, isUploading } = useTrackMediaUpload();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const image = node.image;

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (!file) return;
    if (!QUESTION_IMAGE_CONTENT_TYPES.includes(file.type)) {
      toast.error("Choose a JPG, PNG, WebP or GIF image.");
      return;
    }
    if (file.size > MAX_QUESTION_IMAGE_BYTES) {
      toast.error(
        `That file is ${Math.round(file.size / 1024 / 1024)} MB. Images must be under ${Math.round(MAX_QUESTION_IMAGE_BYTES / 1024 / 1024)} MB.`,
      );
      return;
    }
    const url = await upload(file, "question_image");
    if (!url) return;
    // Replacing a picture keeps its description, so a better photo does not silently drop the alt text.
    onChange({ url, ...(image?.alt ? { alt: image.alt } : {}) });
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="inline-flex items-center gap-1">
        <span className={labelClass}>Image (optional)</span>
        <HelpTip label="A picture shown with the scene — a face, a room, a screen. JPG, PNG, WebP or GIF up to 5 MB. Keep it small: the learner has to load it before they can read on." />
      </span>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
        data-testid="branching-image-file-input"
      />
      {image ? (
        <div className="flex flex-col gap-2 border border-border-light rounded-md p-3">
          <img
            src={image.url}
            alt={image.alt || "Scene image preview"}
            className="max-h-[200px] w-auto self-start rounded-md object-contain"
          />
          <label className="flex flex-col gap-1">
            <span className={labelClass}>Describe the image (for screen readers)</span>
            <input
              type="text"
              maxLength={MAX_QUESTION_MEDIA_ALT_LENGTH}
              value={image.alt ?? ""}
              onChange={event => onChange({ ...image, alt: event.target.value })}
              placeholder="e.g. A woman sitting alone at a kitchen table"
              className={`${inputClass} w-full`}
            />
          </label>
          <div className="flex items-center gap-2">
            <Button
              variant={ButtonVariant.SECONDARY}
              className="!h-8 w-fit text-xs"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
            >
              {isUploading ? "Uploading…" : "Replace"}
            </Button>
            <button
              type="button"
              onClick={() => onChange(undefined)}
              className="inline-flex items-center gap-1 text-xs text-destructive-500 hover:text-destructive-600"
            >
              <Trash className="w-3.5 h-3.5" />
              Remove
            </button>
          </div>
        </div>
      ) : (
        <Button
          variant={ButtonVariant.SECONDARY}
          className="!h-9 w-fit text-sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
        >
          {isUploading ? "Uploading…" : "Upload image"}
        </Button>
      )}
    </div>
  );
};
