import { FC, useEffect, useMemo, useRef, useState } from "react";

import { createPortal } from "react-dom";

import { Tooltip } from "@ally-ui-mono/ui-shared";
import {
  useAcceptImageMutation,
  useDescribeImageMutation,
  useGetImageHistoryQuery,
  useGetImageSlotsQuery,
  useGetImageStudioConfigQuery,
  useGetImageStylesQuery,
} from "@api";
import { Close, TooltipIcon } from "@assets";
import { Button } from "@components/button";
import { ButtonVariant } from "@components/types";
import { useImageStudioJobs } from "@hooks/useImageStudioJobs";
import {
  AcceptedImage,
  GeneratedImage,
  GenerateImageRequest,
  ImageAspectRatio,
  ImageCastOption,
  ImageContext,
  ImageReferenceInput,
  ImageReferenceOption,
  ImageReferenceOptions,
  ImageSafety,
  ImageSlotKind,
  ImageStudioError,
} from "@types";

import { IMAGE_STUDIO_COPY as copy } from "./copy";
import { useCourseImage } from "./CourseImageContext";
import { StyleGallery } from "./StyleGallery";
import { markImageStudioDisabled } from "./useImageStudioEnabled";
import {
  compactContext,
  DESCRIPTION_MAX_LENGTH,
  DESCRIPTION_MIN_LENGTH,
  pickDefaultStyleId,
  readLastStyleId,
  VARIATION_OPTIONS,
  writeLastStyleId,
} from "./utils";

export interface GenerateImageModalProps {
  slotKind: ImageSlotKind;
  /** Stable id of this slot instance: keys in-flight results and history. */
  slotKey: string;
  context?: ImageContext;
  courseStyleId?: string | null;
  courseStyleAnchorId?: string | null;
  /** Opens on this style (e.g. "Create cast sheet" for one style). */
  initialStyleId?: string | null;
  /** Sent with accept, so the course can adopt its first image as the style example. */
  trackId?: string | null;
  referenceOptions?: ImageReferenceOptions;
  /** Characters the author can tick for this generation. */
  castOptions?: ImageCastOption[];
  /** Always sent (a cast sheet is of one fixed character). */
  castCharacterIds?: string[];
  title?: string;
  onAccept: (image: AcceptedImage) => void;
  onClose: () => void;
}

const FALLBACK_MAX_REFERENCES = 5;
const NO_OPTIONS: ImageReferenceOption[] = [];
const FALLBACK_MAX_VARIANTS = 4;

const ASPECT_CLASS: Record<ImageAspectRatio, string> = {
  "16:9": "aspect-video",
  "1:1": "aspect-square",
  "3:2": "aspect-[3/2]",
};

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

const toReferenceInput = (option: ImageReferenceOption): ImageReferenceInput => ({
  role: option.role,
  ...(option.label ? { label: option.label } : {}),
  ...(option.imageId ? { imageId: option.imageId } : { url: option.url }),
});

const SafetyNotice: FC<{ safety?: ImageSafety; message?: string }> = ({ safety, message }) => (
  <div
    role="alert"
    className="flex flex-col gap-1 rounded-md border border-warning-300 bg-warning-50 px-3 py-2 text-sm text-warning-800"
  >
    <span>{safety?.reason || message}</span>
    {safety?.suggestion && (
      <span>
        {copy.safetySuggestionPrefix} {safety.suggestion}
      </span>
    )}
  </div>
);

const Spinner: FC = () => (
  <span
    aria-hidden="true"
    className="inline-block h-4 w-4 animate-spin rounded-full border-b-2 border-primary-500"
  />
);

/**
 * The one Generate dialog every image slot opens: pick a style, describe the
 * picture (or have it drafted from the content), optionally keep people and
 * places consistent with reference images, and choose from 1–4 results.
 * Nothing changes until the author presses "Use this". Results live outside
 * the dialog (see `useImageStudioJobs`), so closing it loses nothing.
 */
export const GenerateImageModal: FC<GenerateImageModalProps> = ({
  slotKind,
  slotKey,
  context,
  courseStyleId,
  courseStyleAnchorId,
  initialStyleId,
  trackId,
  referenceOptions,
  castOptions,
  castCharacterIds,
  title = copy.modalTitle,
  onAccept,
  onClose,
}) => {
  const titleId = `image-studio-title-${slotKind}`;
  const { onImageAccepted } = useCourseImage();
  const { data: config } = useGetImageStudioConfigQuery();
  const { data: styles = [], isLoading: stylesLoading } = useGetImageStylesQuery();
  const { data: slots = [] } = useGetImageSlotsQuery();
  const { data: history = [] } = useGetImageHistoryQuery({ slotKey, limit: 12 });
  const [describe, { isLoading: isDescribing }] = useDescribeImageMutation();
  const [acceptImage] = useAcceptImageMutation();
  const jobs = useImageStudioJobs(slotKey);

  const slotProfile = useMemo(() => slots.find(slot => slot.kind === slotKind), [slots, slotKind]);
  const maxReferences = config?.maxReferences ?? FALLBACK_MAX_REFERENCES;
  const maxVariants = config?.maxVariants ?? FALLBACK_MAX_VARIANTS;
  const aspectClass = ASPECT_CLASS[slotProfile?.aspectRatio ?? "16:9"] ?? ASPECT_CLASS["16:9"];

  const [styleId, setStyleId] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [describedAltText, setDescribedAltText] = useState("");
  const [describeSafety, setDescribeSafety] = useState<ImageSafety | null>(null);
  const [describeError, setDescribeError] = useState<string | null>(null);
  const [variants, setVariants] = useState<number | null>(null);
  const [selectedRefs, setSelectedRefs] = useState<Set<string>>(
    () =>
      new Set(
        (referenceOptions?.suggested ?? [])
          .filter(option => option.selected)
          .map(option => option.key),
      ),
  );
  const [showCourseImages, setShowCourseImages] = useState(false);
  const [castTicked, setCastTicked] = useState<Set<string>>(
    () =>
      new Set(
        (castOptions ?? [])
          .filter(option => option.selected !== false)
          .map(option => option.characterId),
      ),
  );
  const [isStarting, setIsStarting] = useState(false);
  const [startError, setStartError] = useState<ImageStudioError | null>(null);
  const [isOff, setIsOff] = useState(false);
  const [refining, setRefining] = useState<{ imageId: string; instruction: string } | null>(null);
  const [historyPick, setHistoryPick] = useState<string | null>(null);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [acceptError, setAcceptError] = useState<string | null>(null);

  const dialogRef = useRef<HTMLDivElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const isMountedRef = useRef(true);

  // Default style once the gallery and slot profiles are known.
  useEffect(() => {
    if (styleId || styles.length === 0) return;
    setStyleId(
      pickDefaultStyleId({
        styles,
        initialStyleId,
        courseStyleId,
        slotProfile,
        lastStyleId: readLastStyleId(),
      }),
    );
  }, [styles, slotProfile, styleId, initialStyleId, courseStyleId]);

  const effectiveVariants = Math.min(variants ?? slotProfile?.defaultVariants ?? 1, maxVariants);

  // Focus in on open, back where it was on close; Escape closes.
  useEffect(() => {
    isMountedRef.current = true;
    const previous = document.activeElement as HTMLElement | null;
    descriptionRef.current?.focus();
    return () => {
      isMountedRef.current = false;
      previous?.focus?.();
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      // Keep Tab inside the dialog.
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE),
      ).filter(element => !element.hasAttribute("disabled"));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const allowsReferences = !!slotProfile?.allowsReferences;
  const showReferences = allowsReferences || !!referenceOptions;
  const suggested = referenceOptions?.suggested ?? NO_OPTIONS;
  const available = referenceOptions?.available ?? NO_OPTIONS;
  const allOptions = useMemo(() => {
    const byKey = new Map<string, ImageReferenceOption>();
    [...suggested, ...available].forEach(option => {
      if (!byKey.has(option.key)) byKey.set(option.key, option);
    });
    return byKey;
  }, [suggested, available]);

  const toggleReference = (key: string) =>
    setSelectedRefs(current => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else if (next.size < maxReferences) next.add(key);
      return next;
    });

  const buildReferences = (): ImageReferenceInput[] => {
    const references = [...selectedRefs]
      .map(key => allOptions.get(key))
      .filter((option): option is ImageReferenceOption => !!option)
      .map(toReferenceInput);
    // The course's style example keeps every image in the course looking like one set.
    if (
      allowsReferences &&
      courseStyleAnchorId &&
      styleId === courseStyleId &&
      references.length < maxReferences &&
      !references.some(reference => reference.imageId === courseStyleAnchorId)
    ) {
      references.push({ role: "style", imageId: courseStyleAnchorId });
    }
    return references.slice(0, maxReferences);
  };

  const castIds = useMemo(
    () => [...new Set([...(castCharacterIds ?? []), ...castTicked])],
    [castCharacterIds, castTicked],
  );

  const handleStartError = (error: ImageStudioError) => {
    if (!isMountedRef.current) return;
    if (error.status === 503) {
      markImageStudioDisabled();
      setIsOff(true);
    }
    setStartError(error);
  };

  const trimmedDescription = description.trim();
  const canGenerate =
    !!styleId && trimmedDescription.length >= DESCRIPTION_MIN_LENGTH && !isStarting && !isOff;

  const handleGenerate = async () => {
    if (!canGenerate || !styleId) return;
    setStartError(null);
    setIsStarting(true);
    writeLastStyleId(styleId);
    const references = buildReferences();
    const request: GenerateImageRequest = {
      slotKind,
      slotKey,
      styleId,
      description: trimmedDescription,
      variants: effectiveVariants,
      ...(references.length > 0 ? { references } : {}),
      ...(castIds.length > 0 ? { castCharacterIds: castIds } : {}),
      context: compactContext(context),
    };
    try {
      await jobs.start(request);
    } catch (error) {
      handleStartError(error as ImageStudioError);
    } finally {
      if (isMountedRef.current) setIsStarting(false);
    }
  };

  const handleRefine = async (image: GeneratedImage) => {
    const instruction = refining?.instruction.trim();
    if (!instruction) return;
    setStartError(null);
    setIsStarting(true);
    try {
      await jobs.start({
        slotKind,
        slotKey,
        styleId: image.styleId || styleId || "",
        description: image.description || trimmedDescription,
        variants: 1,
        refine: { imageId: image.id, instruction },
        references: [{ role: "previous", imageId: image.id, label: "The image to change" }],
        ...(castIds.length > 0 ? { castCharacterIds: castIds } : {}),
        context: compactContext(context),
      });
      if (isMountedRef.current) setRefining(null);
    } catch (error) {
      handleStartError(error as ImageStudioError);
    } finally {
      if (isMountedRef.current) setIsStarting(false);
    }
  };

  const handleSuggest = async () => {
    setDescribeError(null);
    setDescribeSafety(null);
    try {
      const result = await describe({
        slotKind,
        ...(styleId ? { styleId } : {}),
        context: compactContext(context),
      }).unwrap();
      if (!isMountedRef.current) return;
      if (result.description) setDescription(result.description.slice(0, DESCRIPTION_MAX_LENGTH));
      if (result.altText) setDescribedAltText(result.altText);
      if (result.safety && !result.safety.ok) setDescribeSafety(result.safety);
    } catch {
      if (isMountedRef.current) setDescribeError(copy.suggestFailed);
    }
  };

  const handleUse = async (image: GeneratedImage) => {
    if (!image.imageUrl || acceptingId) return;
    setAcceptError(null);
    setAcceptingId(image.id);
    try {
      await acceptImage({ id: image.id, ...(trackId ? { trackId } : {}) }).unwrap();
    } catch {
      if (isMountedRef.current) {
        setAcceptError(copy.acceptFailed);
        setAcceptingId(null);
      }
      return;
    }
    if (trackId) onImageAccepted?.(image.id);
    jobs.clear();
    onAccept({
      url: image.imageUrl,
      altText: image.altText || describedAltText || image.description || trimmedDescription,
      imageId: image.id,
    });
  };

  const resultIds = new Set(jobs.images.map(image => image.id));
  const earlierTries = history.filter(
    image => image.imageUrl && image.status === "succeeded" && !resultIds.has(image.id),
  );
  const pickedHistory = earlierTries.find(image => image.id === historyPick) ?? null;
  const showMismatch = !!courseStyleId && !!styleId && styleId !== courseStyleId;
  const disabledByConfig = config?.enabled === false || isOff;
  const availableOnly = available.filter(
    option => !suggested.some(chip => chip.key === option.key),
  );
  const pickedFromCourse = availableOnly.filter(option => selectedRefs.has(option.key));

  const renderChip = (option: ImageReferenceOption) => {
    const pressed = selectedRefs.has(option.key);
    const full = !pressed && selectedRefs.size >= maxReferences;
    return (
      <button
        key={option.key}
        type="button"
        aria-pressed={pressed}
        disabled={full}
        onClick={() => toggleReference(option.key)}
        className={`flex max-w-[220px] shrink-0 items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
          pressed
            ? "border-primary-500 bg-primary-50 text-primary-700"
            : "border-border-light bg-white text-typography-700 hover:bg-secondary-50"
        }`}
      >
        <img
          src={option.thumbnailUrl}
          alt=""
          className="h-7 w-7 shrink-0 rounded-full bg-gray-100 object-cover"
        />
        <span className="truncate">{option.label}</span>
        <span aria-hidden="true">{pressed ? "✓" : "+"}</span>
      </button>
    );
  };

  const renderResult = (image: GeneratedImage, index: number) => {
    const settledOk = image.status === "succeeded" && !!image.imageUrl;
    const failedCheck = settledOk && image.check?.passed === false;
    const isRefining = refining?.imageId === image.id;
    return (
      <li
        key={image.id}
        className="flex flex-col gap-2 rounded-md border border-border-light bg-white p-2"
      >
        <div className={`relative w-full overflow-hidden rounded-md bg-gray-100 ${aspectClass}`}>
          {settledOk ? (
            <img
              src={image.imageUrl}
              alt={image.altText || copy.resultAlt(index + 1)}
              className="h-full w-full object-cover"
            />
          ) : image.status === "failed" ? (
            <div className="flex h-full w-full items-center justify-center p-3 text-center text-xs text-destructive-500">
              {image.error || copy.resultFailed}
            </div>
          ) : (
            <div
              role="status"
              className="flex h-full w-full items-center justify-center gap-2 text-xs text-typography-600"
            >
              <Spinner />
              {copy.resultPending}
            </div>
          )}
          {failedCheck && (
            <span className="absolute left-1 top-1 rounded bg-warning-50 px-1.5 py-0.5 text-[11px] font-medium text-warning-800 shadow-sm">
              ⚠ {copy.checkWarning}
            </span>
          )}
        </div>
        {failedCheck && image.check?.issues?.length ? (
          <ul className="list-disc pl-4 text-[11px] text-warning-800">
            {image.check.issues.map(issue => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        ) : null}
        {settledOk && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              className="!h-8 text-xs"
              onClick={() => void handleUse(image)}
              disabled={!!acceptingId}
            >
              {acceptingId === image.id ? copy.using : copy.useThis}
            </Button>
            <Button
              type="button"
              variant={ButtonVariant.SECONDARY}
              className="!h-8 text-xs"
              aria-expanded={isRefining}
              onClick={() =>
                setRefining(isRefining ? null : { imageId: image.id, instruction: "" })
              }
              disabled={disabledByConfig}
            >
              {copy.refine}
            </Button>
          </div>
        )}
        {image.status === "failed" && (
          <button
            type="button"
            onClick={() => jobs.dismiss(image.id)}
            className="self-start text-xs text-typography-500 hover:text-typography-700"
          >
            {copy.dismiss}
          </button>
        )}
        {isRefining && (
          <div className="flex flex-col gap-1">
            <label
              htmlFor={`refine-${image.id}`}
              className="text-xs font-medium text-typography-700"
            >
              {copy.refineLabel}
            </label>
            <input
              id={`refine-${image.id}`}
              type="text"
              value={refining.instruction}
              maxLength={500}
              autoFocus
              onChange={event =>
                setRefining({ imageId: image.id, instruction: event.target.value })
              }
              onKeyDown={event => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void handleRefine(image);
                }
              }}
              placeholder={copy.refinePlaceholder}
              className="w-full rounded-md border border-border-light px-2 py-1 text-sm outline-none focus:border-primary-400"
            />
            <div className="flex gap-2">
              <Button
                type="button"
                className="!h-8 text-xs"
                onClick={() => void handleRefine(image)}
                disabled={!refining.instruction.trim() || isStarting}
              >
                {copy.refineSubmit}
              </Button>
              <Button
                type="button"
                variant={ButtonVariant.SECONDARY}
                className="!h-8 text-xs"
                onClick={() => setRefining(null)}
              >
                {copy.refineCancel}
              </Button>
            </div>
          </div>
        )}
      </li>
    );
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black bg-opacity-50"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative z-10 flex max-h-[90vh] w-[calc(100%-2rem)] max-w-[760px] flex-col rounded-md bg-white shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-border-light px-4 py-3 sm:px-5">
          <h3 id={titleId} className="text-sm font-semibold text-typography-900">
            {title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label={copy.close}
            className="text-typography-500 hover:text-typography-700"
          >
            <Close className="h-4 w-4" />
          </button>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4 sm:px-5">
          {/* ---- Style ---- */}
          {stylesLoading && styles.length === 0 ? (
            <p className="text-xs text-typography-500">{copy.stylesLoading}</p>
          ) : (
            <div className="flex min-w-0 flex-col gap-1">
              <StyleGallery
                name={`image-studio-style-${slotKind}`}
                styles={styles}
                value={styleId}
                onChange={setStyleId}
                courseStyleId={courseStyleId}
              />
              {showMismatch && (
                <p role="note" className="text-xs text-warning-800">
                  {copy.styleMismatch}
                </p>
              )}
            </div>
          )}

          {/* ---- Description ---- */}
          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label
                htmlFor={`image-studio-description-${slotKind}`}
                className="text-sm font-medium text-typography-800"
              >
                {copy.descriptionLabel}
              </label>
              <button
                type="button"
                onClick={() => void handleSuggest()}
                disabled={isDescribing}
                className="text-xs font-medium text-primary-500 hover:text-primary-600 disabled:cursor-not-allowed disabled:text-typography-disabled"
              >
                {isDescribing ? copy.suggesting : copy.suggest}
              </button>
            </div>
            <textarea
              id={`image-studio-description-${slotKind}`}
              ref={descriptionRef}
              value={description}
              onChange={event => setDescription(event.target.value)}
              maxLength={DESCRIPTION_MAX_LENGTH}
              rows={3}
              placeholder={copy.descriptionPlaceholder}
              aria-describedby={`image-studio-description-hint-${slotKind}`}
              className="w-full resize-y rounded-md border border-border-light px-3 py-2 text-sm leading-relaxed outline-none focus:border-primary-400"
            />
            <p
              id={`image-studio-description-hint-${slotKind}`}
              className="text-xs text-typography-500"
            >
              {copy.descriptionHint}
            </p>
            {describeError && (
              <p role="alert" className="text-xs text-destructive-500">
                {describeError}
              </p>
            )}
            {describeSafety && <SafetyNotice safety={describeSafety} />}
          </div>

          {/* ---- Cast for this generation ---- */}
          {castOptions && castOptions.length > 0 && (
            <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <legend className="mb-1 inline-flex items-center gap-1 text-sm font-medium text-typography-800">
                {copy.castLabel}
                <Tooltip label={copy.castHelp} align="top">
                  <button type="button" className="inline-flex cursor-pointer items-center">
                    <TooltipIcon />
                  </button>
                </Tooltip>
              </legend>
              {castOptions.map(option => (
                <label
                  key={option.characterId}
                  className="inline-flex items-center gap-1.5 text-sm text-typography-800"
                >
                  <input
                    type="checkbox"
                    checked={castTicked.has(option.characterId)}
                    onChange={() =>
                      setCastTicked(current => {
                        const next = new Set(current);
                        if (next.has(option.characterId)) next.delete(option.characterId);
                        else next.add(option.characterId);
                        return next;
                      })
                    }
                  />
                  {option.name}
                </label>
              ))}
            </fieldset>
          )}

          {/* ---- References ---- */}
          {showReferences && (suggested.length > 0 || available.length > 0) && (
            <div className="flex min-w-0 flex-col gap-2">
              <span className="inline-flex items-center gap-1 text-sm font-medium text-typography-800">
                {copy.referencesLabel}
                <Tooltip label={copy.referencesHelp} align="top">
                  <button type="button" className="inline-flex cursor-pointer items-center">
                    <TooltipIcon />
                  </button>
                </Tooltip>
                <span className="text-xs font-normal text-typography-500">
                  {copy.referencesMax(maxReferences)}
                </span>
              </span>
              <div className="flex flex-wrap gap-2">
                {suggested.map(renderChip)}
                {pickedFromCourse.map(renderChip)}
              </div>
              {availableOnly.length > 0 && (
                <>
                  <button
                    type="button"
                    aria-expanded={showCourseImages}
                    onClick={() => setShowCourseImages(open => !open)}
                    className="self-start text-xs font-medium text-primary-500 hover:text-primary-600"
                  >
                    {showCourseImages ? copy.hideCourseImages : copy.addFromCourse}
                  </button>
                  {showCourseImages && (
                    <ul className="flex gap-2 overflow-x-auto pb-1 custom-scrollbar">
                      {availableOnly.map(option => {
                        const pressed = selectedRefs.has(option.key);
                        return (
                          <li key={option.key} className="shrink-0">
                            <button
                              type="button"
                              aria-pressed={pressed}
                              aria-label={option.label}
                              title={option.label}
                              disabled={!pressed && selectedRefs.size >= maxReferences}
                              onClick={() => toggleReference(option.key)}
                              className={`block h-16 w-24 overflow-hidden rounded-md border-2 disabled:opacity-50 ${
                                pressed ? "border-primary-500" : "border-transparent"
                              }`}
                            >
                              <img
                                src={option.thumbnailUrl}
                                alt=""
                                className="h-full w-full object-cover"
                              />
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </>
              )}
            </div>
          )}

          {/* ---- Variations + Generate ---- */}
          {!disabledByConfig && (
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div
                role="radiogroup"
                aria-label={copy.variationsLabel}
                className="flex flex-col gap-1"
              >
                <span aria-hidden="true" className="text-xs font-medium text-typography-700">
                  {copy.variationsLabel}
                </span>
                <div className="inline-flex overflow-hidden rounded-md border border-border-light">
                  {VARIATION_OPTIONS.filter(option => option <= maxVariants).map(option => {
                    const checked = effectiveVariants === option;
                    return (
                      <label
                        key={option}
                        className={`cursor-pointer px-3 py-1 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary-400 ${
                          checked
                            ? "bg-typography-900 text-white"
                            : "bg-white text-typography-700 hover:bg-gray-100"
                        }`}
                      >
                        <input
                          type="radio"
                          name={`image-studio-variants-${slotKind}`}
                          value={option}
                          checked={checked}
                          onChange={() => setVariants(option)}
                          className="sr-only"
                        />
                        {option}
                      </label>
                    );
                  })}
                </div>
              </div>
              <Button
                type="button"
                className="!h-9 text-sm"
                onClick={() => void handleGenerate()}
                disabled={!canGenerate}
              >
                {isStarting ? copy.generatingButton : copy.generateButton}
              </Button>
            </div>
          )}

          {disabledByConfig && (
            <p role="status" className="text-sm text-typography-600">
              {startError?.message ?? "Image generation is turned off right now."}
            </p>
          )}

          {startError && !disabledByConfig && (
            <SafetyNotice safety={startError.safety} message={startError.message} />
          )}

          {/* Reserved line, so the layout does not jump as polling starts and stops. */}
          <p
            role="status"
            aria-live="polite"
            className="min-h-[1.25rem] text-xs text-typography-600"
          >
            {jobs.isGenerating ? copy.generatingStatus : (jobs.error ?? "")}
          </p>

          {acceptError && (
            <p role="alert" className="text-sm text-destructive-500">
              {acceptError}
            </p>
          )}

          {/* ---- Results ---- */}
          {jobs.images.length > 0 && (
            <section aria-label={copy.resultsLabel} className="flex flex-col gap-2">
              <h4 className="text-sm font-medium text-typography-800">{copy.resultsLabel}</h4>
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {jobs.images.map(renderResult)}
              </ul>
            </section>
          )}

          {/* ---- Earlier tries ---- */}
          {earlierTries.length > 0 && (
            <section aria-label={copy.historyLabel} className="flex min-w-0 flex-col gap-2">
              <h4 className="text-sm font-medium text-typography-800">{copy.historyLabel}</h4>
              <ul className="flex gap-2 overflow-x-auto pb-1 custom-scrollbar">
                {earlierTries.map((image, index) => (
                  <li key={image.id} className="shrink-0">
                    <button
                      type="button"
                      aria-pressed={historyPick === image.id}
                      onClick={() => setHistoryPick(historyPick === image.id ? null : image.id)}
                      className={`block h-16 w-24 overflow-hidden rounded-md border-2 ${
                        historyPick === image.id ? "border-primary-500" : "border-transparent"
                      }`}
                    >
                      <img
                        src={image.imageUrl}
                        alt={image.altText || copy.historyAlt(index + 1)}
                        className="h-full w-full object-cover"
                      />
                    </button>
                  </li>
                ))}
              </ul>
              {pickedHistory && (
                <Button
                  type="button"
                  className="!h-8 w-fit text-xs"
                  onClick={() => void handleUse(pickedHistory)}
                  disabled={!!acceptingId}
                >
                  {acceptingId === pickedHistory.id ? copy.using : copy.useThis}
                </Button>
              )}
            </section>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border-light px-4 py-3 sm:px-5">
          <Button
            type="button"
            variant={ButtonVariant.SECONDARY}
            className="!h-9 text-sm"
            onClick={onClose}
          >
            {copy.close}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
};
