import React, { useRef, useState } from "react";

import { FileText, FileUp, X } from "lucide-react";
import { toast } from "sonner";

import { InlineLoading } from "@ally-ui-mono/ui-shared";
import {
  useGetCourseCopilotSourcesQuery,
  useRemoveCourseCopilotSourceMutation,
  useUploadCourseCopilotSourceMutation,
} from "@api";
import { en } from "@constants";
import { CourseCopilotSource } from "@types";

const ACCEPT =
  ".pdf,.docx,.pptx,application/pdf," +
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document," +
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

/** The server's own message for a refused file (format, size, count, no text), or a fallback. */
const messageOf = (error: unknown, fallback: string): string => {
  const data = (error as { data?: { message?: unknown } })?.data;
  const message = Array.isArray(data?.message) ? data?.message.join(" ") : data?.message;
  return typeof message === "string" && message.trim() ? message : fallback;
};

export interface ReferenceFilesProps {
  sessionId: string;
  /** Why files can't change right now (a build is running, the session is archived). */
  lockedReason?: string | null;
  /** `opening`: a full drop zone on the first screen. `pane`: a compact list in the Brief pane. */
  variant?: "opening" | "pane";
}

/**
 * The partner's manuals, decks and handouts attached to one Copilot session.
 *
 * Files are uploaded one request at a time, so one bad file (a scanned PDF, an old .ppt) is
 * refused on its own with the server's reason, and the rest still attach. Each row says what
 * Copilot got out of the file (pages, passages), so a file that read as almost nothing is
 * visible before the course is built from it.
 */
export const ReferenceFiles: React.FC<ReferenceFilesProps> = ({
  sessionId,
  lockedReason = null,
  variant = "pane",
}) => {
  const strings = en.courseCopilot.sources;
  const { data: sources = [] } = useGetCourseCopilotSourcesQuery(sessionId, { skip: !sessionId });
  const [upload] = useUploadCourseCopilotSourceMutation();
  const [remove] = useRemoveCourseCopilotSourceMutation();
  const [pending, setPending] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const locked = Boolean(lockedReason);

  const attach = async (files: File[]) => {
    if (locked || !files.length) return;
    setErrors([]);
    for (const file of files) {
      setPending(current => [...current, file.name]);
      try {
        await upload({ id: sessionId, file }).unwrap();
      } catch (error) {
        setErrors(current => [...current, messageOf(error, strings.uploadFailed(file.name))]);
      } finally {
        setPending(current => current.filter(name => name !== file.name));
      }
    }
  };

  const detach = async (source: CourseCopilotSource) => {
    try {
      await remove({ id: sessionId, sourceId: source.id }).unwrap();
    } catch (error) {
      toast.error(messageOf(error, strings.removeFailed));
    }
  };

  const isOpening = variant === "opening";
  const hasFiles = sources.length > 0 || pending.length > 0;
  // In the pane, an empty list with nothing to add is just noise.
  if (!isOpening && locked && !sources.length) return null;

  return (
    <section
      aria-label={strings.title}
      className={
        isOpening ? "flex flex-col gap-2" : "flex flex-col gap-2 border-b border-neutral-200 p-4"
      }
      data-testid="course-copilot-reference-files"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold text-typography-900">{strings.title}</h3>
        {/* With files attached, adding more is a small link, not a second drop zone. */}
        {hasFiles && !locked && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="inline-flex items-center gap-1 text-xs font-medium text-primary-700 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500"
          >
            <FileUp size={12} aria-hidden /> {strings.addMore}
          </button>
        )}
      </div>
      {!hasFiles && (
        <p className="-mt-1 text-xs text-typography-600">
          {isOpening ? strings.openingHint : strings.paneHint}
        </p>
      )}

      {!locked && (
        <div
          hidden={hasFiles}
          onDragOver={event => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={event => {
            event.preventDefault();
            setDragging(false);
            void attach(Array.from(event.dataTransfer.files ?? []));
          }}
          className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded border border-dashed px-3 ${
            isOpening ? "py-4" : "py-2"
          } ${dragging ? "border-primary-500 bg-primary-50" : "border-neutral-300"}`}
        >
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="inline-flex items-center gap-2 rounded border border-primary-500 px-3 py-1.5 text-sm font-medium text-primary-700 hover:bg-primary-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500"
          >
            <FileUp size={14} aria-hidden /> {strings.choose}
          </button>
          <span className="text-xs text-typography-600">{strings.dropHint}</span>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={ACCEPT}
            className="hidden"
            data-testid="course-copilot-source-input"
            onChange={event => {
              const chosen = Array.from(event.target.files ?? []);
              event.target.value = "";
              void attach(chosen);
            }}
          />
        </div>
      )}

      {(sources.length > 0 || pending.length > 0) && (
        <ul className="flex flex-col gap-1">
          {sources.map(source => (
            <li
              key={source.id}
              className="flex items-center gap-2 rounded bg-neutral-50 px-3 py-1.5 text-sm"
            >
              <FileText size={14} aria-hidden className="shrink-0 text-typography-500" />
              <span className="min-w-0 flex-1 truncate text-typography-900" title={source.fileName}>
                {source.fileName}
              </span>
              <span className="shrink-0 text-xs text-typography-500">
                {source.pageCount
                  ? strings.pages(source.pageCount, source.kind)
                  : strings.passages(source.passageCount)}
              </span>
              {!locked && (
                <button
                  type="button"
                  aria-label={strings.remove(source.fileName)}
                  title={strings.remove(source.fileName)}
                  onClick={() => void detach(source)}
                  className="shrink-0 rounded p-1 text-typography-500 hover:bg-neutral-200 hover:text-typography-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500"
                >
                  <X size={14} aria-hidden />
                </button>
              )}
            </li>
          ))}
          {pending.map(name => (
            <li key={`pending-${name}`} className="px-3 py-1">
              <InlineLoading description={strings.uploading(name)} />
            </li>
          ))}
        </ul>
      )}

      {errors.length > 0 && (
        <ul role="alert" className="flex flex-col gap-0.5 text-xs text-destructive-600">
          {errors.map((error, index) => (
            <li key={`${error}-${index}`}>{error}</li>
          ))}
        </ul>
      )}

      {locked ? (
        <p className="text-xs text-typography-500">{lockedReason}</p>
      ) : (
        sources.length > 0 && <p className="text-xs text-typography-500">{strings.privacy}</p>
      )}
    </section>
  );
};
