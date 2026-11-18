import { FC, useEffect, useMemo, useRef, useState } from "react";

import { createPortal } from "react-dom";

import { Tooltip } from "@ally-ui-mono/ui-shared";
import {
  useAcceptImageMutation,
  useEstimateImagesMutation,
  useGetImageSlotsQuery,
  useGetImageStudioConfigQuery,
  useGetImageStylesQuery,
} from "@api";
import { Close, TooltipIcon } from "@assets";
import { Button } from "@components/button";
import { StyleGallery } from "@components/image-studio/StyleGallery";
import {
  pickDefaultStyleId,
  readLastStyleId,
  writeLastStyleId,
} from "@components/image-studio/utils";
import { ButtonVariant } from "@components/types";
import { imageJobStore } from "@hooks/imageStudioJobStore";
import { useImageStudioJobs, useSlotImageJobs } from "@hooks/useImageStudioJobs";
import {
  BranchingCastMember,
  BranchingImage,
  BranchingNode,
  BranchingScenarioContent,
  ImageEstimate,
  ImageStudioError,
} from "@types";

import {
  buildFillSceneRequests,
  emptyScenes,
  sceneDisplayName,
  sceneSlotKey,
} from "../../../branchingImages";
import { CharacterPicker } from "../../landing/CharacterPicker";

export interface BranchingImageToolsProps {
  content: BranchingScenarioContent;
  trackId?: string | null;
  itemId: string;
  courseStyleId?: string | null;
  courseTitle?: string;
  onCastChange: (cast: BranchingCastMember[]) => void;
  /** Puts an accepted picture on a scene. Never called without the author's say-so. */
  onApplyImage: (nodeId: string, image: BranchingImage) => void;
}

const MAX_CAST = 8;
const DEFAULT_MAX_BATCH = 20;

const formatUsd = (value: number) =>
  `$${value.toFixed(value > 0 && value < 0.1 ? 3 : 2).replace(/\.?0+$/, "") || "0"}`;

const HelpTip: FC<{ label: string }> = ({ label }) => (
  <Tooltip label={label} align="top">
    <button type="button" className="cursor-pointer inline-flex items-center">
      <TooltipIcon />
    </button>
  </Tooltip>
);

/* ---- Cast ----------------------------------------------------------------- */

const CastControl: FC<{
  cast: BranchingCastMember[];
  onChange: (cast: BranchingCastMember[]) => void;
}> = ({ cast, onChange }) => (
  <div className="flex flex-col gap-2" data-testid="branching-cast">
    <span className="inline-flex items-center gap-1 text-sm font-semibold text-typography-900">
      Cast
      <HelpTip label="Characters from the Character Library who appear in this scenario's pictures. Their Appearance line and cast sheet keep them looking the same in every scene. You can untick someone for a single picture." />
    </span>
    {cast.length > 0 ? (
      <ul className="flex flex-wrap gap-2">
        {cast.map(member => (
          <li
            key={member.characterId}
            className="inline-flex items-center gap-1 rounded-full border border-border-light bg-white py-0.5 pl-3 pr-1 text-sm text-typography-800"
          >
            {member.name}
            <button
              type="button"
              aria-label={`Remove ${member.name} from the cast`}
              onClick={() =>
                onChange(cast.filter(other => other.characterId !== member.characterId))
              }
              className="flex h-6 w-6 items-center justify-center rounded-full text-typography-500 hover:bg-secondary-50 hover:text-destructive-500"
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
    ) : (
      <p className="text-xs text-typography-500">No one yet.</p>
    )}
    {cast.length < MAX_CAST && (
      <CharacterPicker
        openLabel="Add to cast"
        hint="Pick the people who appear in the pictures."
        onPick={character => {
          if (!character.id || cast.some(member => member.characterId === character.id)) return;
          onChange([...cast, { characterId: character.id, name: character.name }]);
        }}
      />
    )}
  </div>
);

/* ---- Fill empty scenes ------------------------------------------------------ */

const SceneResultRow: FC<{
  name: string;
  slotKey: string;
  trackId?: string | null;
  onAccept: (image: BranchingImage) => void;
}> = ({ name, slotKey, trackId, onAccept }) => {
  const { images } = useSlotImageJobs(slotKey);
  const [acceptImage] = useAcceptImageMutation();
  const [state, setState] = useState<"idle" | "accepting" | "added" | "error">("idle");
  const image = images[0];

  const handleAccept = async () => {
    if (!image?.imageUrl) return;
    setState("accepting");
    try {
      await acceptImage({ id: image.id, ...(trackId ? { trackId } : {}) }).unwrap();
    } catch {
      setState("error");
      return;
    }
    imageJobStore.clear(slotKey);
    onAccept({ url: image.imageUrl, ...(image.altText ? { alt: image.altText } : {}) });
    setState("added");
  };

  return (
    <li className="flex items-center gap-3 rounded-md border border-border-light p-2">
      <div className="flex h-14 w-24 shrink-0 items-center justify-center overflow-hidden rounded-md bg-gray-100">
        {image?.status === "succeeded" && image.imageUrl ? (
          <img
            src={image.imageUrl}
            alt={image.altText || name}
            className="h-full w-full object-cover"
          />
        ) : image?.status === "failed" ? (
          <span className="px-1 text-center text-[11px] text-destructive-500">Failed</span>
        ) : state === "added" ? (
          <span className="text-[11px] text-typography-500">Added</span>
        ) : (
          <span
            aria-hidden="true"
            className="inline-block h-4 w-4 animate-spin rounded-full border-b-2 border-primary-500"
          />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm text-typography-900">{name}</span>
        <span className="text-xs text-typography-500">
          {state === "added"
            ? "Added to the scene."
            : state === "error"
              ? "Couldn't add it. Try again."
              : image?.status === "failed"
                ? image.error || "Couldn't make this one."
                : image?.status === "succeeded"
                  ? image.check?.passed === false
                    ? "May not match — check closely"
                    : "Ready"
                  : "Generating…"}
        </span>
      </div>
      {image?.status === "succeeded" && state !== "added" && (
        <Button
          type="button"
          className="!h-8 text-xs"
          onClick={() => void handleAccept()}
          disabled={state === "accepting"}
        >
          {state === "accepting" ? "Adding…" : "Accept"}
        </Button>
      )}
    </li>
  );
};

const FillEmptyScenesDialog: FC<
  Omit<BranchingImageToolsProps, "onCastChange"> & { scenes: BranchingNode[]; onClose: () => void }
> = ({ content, scenes, trackId, itemId, courseStyleId, courseTitle, onApplyImage, onClose }) => {
  const { data: config } = useGetImageStudioConfigQuery();
  const { data: styles = [] } = useGetImageStylesQuery();
  const { data: slots = [] } = useGetImageSlotsQuery();
  const [estimate, { isLoading: isEstimating }] = useEstimateImagesMutation();
  const jobs = useImageStudioJobs(`track:${trackId || "new"}:item:${itemId}:fill`);
  const [styleId, setStyleId] = useState<string | null>(null);
  const [cost, setCost] = useState<ImageEstimate | null>(null);
  const [costFailed, setCostFailed] = useState(false);
  const [started, setStarted] = useState<BranchingNode[] | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<ImageStudioError | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  const maxBatch = config?.maxBatch ?? DEFAULT_MAX_BATCH;
  const batchScenes = useMemo(() => scenes.slice(0, maxBatch), [scenes, maxBatch]);
  const sceneProfile = slots.find(slot => slot.kind === "scene");

  useEffect(() => {
    if (styleId || styles.length === 0) return;
    setStyleId(
      pickDefaultStyleId({
        styles,
        initialStyleId: courseStyleId ?? readLastStyleId(),
        slotProfile: sceneProfile,
      }),
    );
  }, [styles, styleId, courseStyleId, sceneProfile]);

  const requests = useMemo(
    () =>
      styleId
        ? buildFillSceneRequests({
            content,
            nodes: batchScenes,
            trackId,
            itemId,
            styleId,
            courseTitle,
          })
        : [],
    [content, batchScenes, trackId, itemId, styleId, courseTitle],
  );

  // The cost, before anything is spent.
  useEffect(() => {
    if (started || requests.length === 0) return undefined;
    let cancelled = false;
    setCostFailed(false);
    estimate({ items: requests })
      .unwrap()
      .then(result => {
        if (!cancelled) setCost(result);
      })
      .catch(() => {
        if (!cancelled) {
          setCost(null);
          setCostFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
    // `requests` changes with the style; that is when the cost changes too.
  }, [requests, estimate, started]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    confirmRef.current?.focus();
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleConfirm = async () => {
    if (requests.length === 0 || !styleId) return;
    setError(null);
    setIsStarting(true);
    writeLastStyleId(styleId);
    try {
      await jobs.startBatch({ items: requests });
      const startedIds = new Set(requests.map(request => request.slotKey));
      setStarted(
        batchScenes.filter(node => startedIds.has(sceneSlotKey(trackId, itemId, node.id))),
      );
    } catch (caught) {
      setError(caught as ImageStudioError);
    } finally {
      setIsStarting(false);
    }
  };

  const skipped = batchScenes.length - requests.length;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black bg-opacity-50"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="fill-empty-scenes-title"
        className="relative z-10 flex max-h-[90vh] w-[calc(100%-2rem)] max-w-[560px] flex-col rounded-md bg-white shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-border-light px-4 py-3 sm:px-5">
          <h3 id="fill-empty-scenes-title" className="text-sm font-semibold text-typography-900">
            Fill empty scenes
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-typography-500 hover:text-typography-700"
          >
            <Close className="h-4 w-4" />
          </button>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4 sm:px-5">
          {!started ? (
            <>
              <p className="text-sm text-typography-700">
                One picture for each scene without one, made from the scene&apos;s title and text.
                You choose which to add — nothing is changed until you accept it.
              </p>
              <ul className="flex flex-col gap-1 text-sm text-typography-800" aria-label="Scenes">
                {batchScenes.map(node => (
                  <li key={node.id} className="truncate">
                    • {sceneDisplayName(content, node)}
                  </li>
                ))}
              </ul>
              {scenes.length > batchScenes.length && (
                <p className="text-xs text-typography-500">
                  {`The first ${maxBatch} scenes only. Run it again for the rest.`}
                </p>
              )}
              {skipped > 0 && (
                <p className="text-xs text-typography-500">
                  {`${skipped} scene${skipped === 1 ? " has" : "s have"} no text yet and will be skipped.`}
                </p>
              )}
              <StyleGallery
                name="fill-empty-scenes-style"
                styles={styles}
                value={styleId}
                onChange={setStyleId}
                courseStyleId={courseStyleId}
                compact
              />
              <p role="status" className="min-h-[1.25rem] text-sm text-typography-800">
                {isEstimating
                  ? "Working out the cost…"
                  : cost
                    ? `${cost.images} image${cost.images === 1 ? "" : "s"} · about ${formatUsd(cost.totalUsd)}`
                    : costFailed
                      ? "Couldn't work out the cost."
                      : ""}
              </p>
              {error && (
                <div
                  role="alert"
                  className="rounded-md border border-warning-300 bg-warning-50 px-3 py-2 text-sm text-warning-800"
                >
                  {error.safety?.reason || error.message}
                  {error.safety?.suggestion ? ` Try: ${error.safety.suggestion}` : ""}
                </div>
              )}
            </>
          ) : (
            <>
              <p role="status" className="text-xs text-typography-600">
                {jobs.isGenerating || started.length > 0
                  ? "Generating — usually under a minute. You can close this and keep working; each scene shows its picture when it's ready."
                  : ""}
              </p>
              <ul className="flex flex-col gap-2">
                {started.map(node => (
                  <SceneResultRow
                    key={node.id}
                    name={sceneDisplayName(content, node)}
                    slotKey={sceneSlotKey(trackId, itemId, node.id)}
                    trackId={trackId}
                    onAccept={image => onApplyImage(node.id, image)}
                  />
                ))}
              </ul>
            </>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border-light px-4 py-3 sm:px-5">
          <Button
            type="button"
            variant={ButtonVariant.SECONDARY}
            className="!h-9 text-sm"
            onClick={onClose}
          >
            {started ? "Close" : "Cancel"}
          </Button>
          {!started && (
            <Button
              ref={confirmRef}
              type="button"
              className="!h-9 text-sm"
              onClick={() => void handleConfirm()}
              disabled={requests.length === 0 || isStarting}
            >
              {isStarting
                ? "Starting…"
                : `Generate ${requests.length} image${requests.length === 1 ? "" : "s"}`}
            </Button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
};

/**
 * Branching editor → image tools: the scenario's Cast and "Fill empty scenes".
 * Loaded on demand, only while Image Studio is on.
 */
const BranchingImageTools: FC<BranchingImageToolsProps> = props => {
  const { content, onCastChange } = props;
  const [isFillOpen, setIsFillOpen] = useState(false);
  const scenes = emptyScenes(content);

  return (
    <div className="rounded-md border border-border-light bg-secondary-50 px-4 py-3 flex flex-col gap-3">
      <CastControl cast={content.imageCast ?? []} onChange={onCastChange} />
      <div className="flex flex-wrap items-center gap-2 border-t border-border-light pt-3">
        <Button
          type="button"
          variant={ButtonVariant.SECONDARY}
          className="!h-9 w-fit text-sm"
          onClick={() => setIsFillOpen(true)}
          disabled={scenes.length === 0}
        >
          ✨ Fill empty scenes
        </Button>
        <span className="text-xs text-typography-500">
          {scenes.length === 0
            ? "Every scene has a picture."
            : `${scenes.length} scene${scenes.length === 1 ? "" : "s"} without a picture.`}
        </span>
        <HelpTip label="Makes one picture for each scene that has none, from the scene's title and text, in one go. You see the cost first, and you accept each picture yourself." />
      </div>
      {isFillOpen && (
        <FillEmptyScenesDialog {...props} scenes={scenes} onClose={() => setIsFillOpen(false)} />
      )}
    </div>
  );
};

export default BranchingImageTools;
