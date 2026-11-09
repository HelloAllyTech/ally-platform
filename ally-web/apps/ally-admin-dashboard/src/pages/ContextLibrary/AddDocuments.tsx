import React, { useEffect, useRef, useState } from "react";

import { ChevronDown, FilePlus2, FileUp, PenLine, Plus, Table2, UploadCloud } from "lucide-react";

import { en } from "@constants";
import { ContextCollection } from "@types";

import { splitDocuments } from "./contextLibraryFormat";
import { Sheet } from "../Builder/room/Sheet";

export const DOCUMENT_ACCEPT = ".pdf,.epub,application/pdf,application/epub+zip";
const TARGETS_KEY = "contextLibrary.uploadTargets";

/** The collections a drop goes to by default: the one in view, else the last used. */
export const defaultTargets = (
  documentCollections: ContextCollection[],
  currentId?: string | null,
): string[] => {
  if (currentId && documentCollections.some(c => c.id === currentId)) return [currentId];
  try {
    const saved = JSON.parse(localStorage.getItem(TARGETS_KEY) ?? "[]") as unknown;
    if (Array.isArray(saved)) {
      const valid = saved.filter(
        (id): id is string => typeof id === "string" && documentCollections.some(c => c.id === id),
      );
      if (valid.length) return valid;
    }
  } catch {
    /* storage unavailable */
  }
  return documentCollections[0] ? [documentCollections[0].id] : [];
};

export const rememberTargets = (ids: string[]) => {
  try {
    localStorage.setItem(TARGETS_KEY, JSON.stringify(ids));
  } catch {
    /* storage unavailable */
  }
};

const targetName = (collections: ContextCollection[], ids: string[]) =>
  ids.map(id => collections.find(c => c.id === id)?.name ?? id).join(", ") ||
  en.contextLibrary.switcher.all;

/* ── Whole-page drop overlay ─────────────────────────────────────────── */

const fileCount = (event: DragEvent): number | null => {
  const items = event.dataTransfer?.items;
  if (!items) return null;
  return Array.from(items).filter(item => item.kind === "file").length;
};

const hasFiles = (event: DragEvent) =>
  Array.from(event.dataTransfer?.types ?? []).includes("Files");

/**
 * Listens for files dragged over the whole window and shows where they will go. Browsers
 * don't reveal file names until the drop, so the overlay counts; the dialog that follows names
 * anything that will be skipped and lets the collections be changed.
 */
export const useDocumentDrop = (enabled: boolean, onDrop: (files: File[]) => void) => {
  const [dragCount, setDragCount] = useState<number | null | undefined>(undefined);
  const depth = useRef(0);
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;

  useEffect(() => {
    if (!enabled) return undefined;
    const onEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth.current += 1;
      setDragCount(fileCount(event));
    };
    const onOver = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };
    const onLeave = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragCount(undefined);
    };
    const onDropEvent = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth.current = 0;
      setDragCount(undefined);
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length) onDropRef.current(files);
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDropEvent);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDropEvent);
    };
  }, [enabled]);

  return { dragging: dragCount !== undefined, dragCount: dragCount ?? null };
};

export const DropOverlay: React.FC<{
  count: number | null;
  collections: ContextCollection[];
  targets: string[];
}> = ({ count, collections, targets }) => {
  const strings = en.contextLibrary.drop;
  const name = targetName(collections, targets);
  return (
    <div
      className="pointer-events-none fixed inset-0 z-[70] flex items-center justify-center bg-primary-900/40 p-6"
      data-testid="cl-drop-overlay"
    >
      <div className="rounded-lg border-2 border-dashed border-white bg-white px-8 py-6 text-center shadow-xl">
        <UploadCloud size={32} aria-hidden className="mx-auto mb-2 text-primary-600" />
        <p className="flex items-center justify-center gap-1 text-lg font-semibold">
          {count ? strings.overlay(count, name) : strings.overlayUnknown(name)}
          <ChevronDown size={18} aria-hidden />
        </p>
        <p className="mt-1 text-sm text-typography-600">{strings.onlyPdfEpub}</p>
      </div>
    </div>
  );
};

/* ── Confirm: where these go, and what's skipped ──────────────────────── */

export interface AddDocumentsChoice {
  files: File[];
  collections: string[];
  docVersion?: string;
  year?: number;
}

export const AddDocumentsDialog: React.FC<{
  files: File[];
  documentCollections: ContextCollection[];
  initialTargets: string[];
  onConfirm: (choice: AddDocumentsChoice) => void;
  onCancel: () => void;
}> = ({ files, documentCollections, initialTargets, onConfirm, onCancel }) => {
  const strings = en.contextLibrary.drop;
  const { accepted, skipped } = splitDocuments(files);
  const [targets, setTargets] = useState<string[]>(initialTargets);
  const [docVersion, setDocVersion] = useState("");
  const [year, setYear] = useState("");
  const addRef = useRef<HTMLButtonElement>(null);
  useEffect(() => addRef.current?.focus(), []);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!accepted.length || !targets.length) return;
    const parsedYear = Number(year);
    onConfirm({
      files: accepted,
      collections: targets,
      docVersion: docVersion.trim() || undefined,
      year: Number.isInteger(parsedYear) && parsedYear > 0 ? parsedYear : undefined,
    });
  };

  return (
    <Sheet title={strings.confirmTitle(accepted.length)} placement="side" onClose={onCancel}>
      <form onSubmit={submit} className="space-y-5" data-testid="cl-add-documents">
        {accepted.length > 0 ? (
          <ul className="space-y-1 text-sm">
            {accepted.map((file, i) => (
              <li key={`${file.name}-${i}`} className="flex items-center gap-2">
                <FileUp size={14} aria-hidden className="text-typography-500" /> {file.name}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-typography-700">{strings.nothingToAdd}</p>
        )}
        {skipped.length > 0 && (
          <ul className="space-y-1 text-sm text-amber-700" data-testid="cl-skipped-files">
            {skipped.map((file, i) => (
              <li key={`${file.name}-${i}`}>{strings.skipped(file.name)}</li>
            ))}
          </ul>
        )}
        <fieldset className="space-y-1">
          <legend className="mb-1 text-xs text-typography-700">{strings.targetLabel}</legend>
          {documentCollections.map(c => (
            <label key={c.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={targets.includes(c.id)}
                onChange={event =>
                  setTargets(previous =>
                    event.target.checked ? [...previous, c.id] : previous.filter(id => id !== c.id),
                  )
                }
              />
              {c.name}
            </label>
          ))}
          {!targets.length && <p className="text-xs text-red-700">{strings.pickCollection}</p>}
        </fieldset>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm">
            <span className="mb-1 block text-xs text-typography-700" title={strings.versionHelp}>
              {strings.version}
            </span>
            <input
              value={docVersion}
              onChange={event => setDocVersion(event.target.value)}
              maxLength={64}
              className="h-9 w-full rounded border border-border-light px-2"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-typography-700">{strings.year}</span>
            <input
              value={year}
              onChange={event => setYear(event.target.value.replace(/\D/g, "").slice(0, 4))}
              inputMode="numeric"
              className="h-9 w-full rounded border border-border-light px-2"
            />
          </label>
        </div>
        <p className="text-xs text-typography-600">{en.contextLibrary.firstRun.privacy}</p>
        <div className="flex justify-end gap-2 border-t border-border-light pt-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded px-4 py-2 text-sm hover:bg-neutral-100"
          >
            {strings.cancel}
          </button>
          <button
            ref={addRef}
            type="submit"
            disabled={!accepted.length || !targets.length}
            className="rounded bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500"
          >
            {strings.confirm}
          </button>
        </div>
      </form>
    </Sheet>
  );
};

/* ── First run: an empty library ─────────────────────────────────────── */

export const FirstRunHero: React.FC<{
  documentCollections: ContextCollection[];
  initialTargets: string[];
  canEdit: boolean;
  onFiles: (files: File[], targets: string[]) => void;
  onWrite: () => void;
}> = ({ documentCollections, initialTargets, canEdit, onFiles, onWrite }) => {
  const strings = en.contextLibrary.firstRun;
  const [targets, setTargets] = useState(initialTargets);
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <section
      className="mx-auto max-w-2xl rounded-lg border-2 border-dashed border-border-light px-6 py-10 text-center"
      data-testid="cl-first-run"
      onDragOver={event => event.preventDefault()}
    >
      <UploadCloud size={36} aria-hidden className="mx-auto mb-3 text-primary-600" />
      <h2 className="text-xl font-semibold text-typography-900">{strings.title}</h2>
      <p className="mx-auto mt-2 max-w-xl text-sm text-typography-600">{strings.privacy}</p>
      {canEdit && documentCollections.length > 0 && (
        <>
          <fieldset className="mt-5 flex flex-wrap justify-center gap-3">
            <legend className="mb-2 w-full text-xs text-typography-700">
              {strings.collectionsLabel}
            </legend>
            {documentCollections.map(c => (
              <label key={c.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={targets.includes(c.id)}
                  onChange={event =>
                    setTargets(previous =>
                      event.target.checked
                        ? [...previous, c.id]
                        : previous.filter(id => id !== c.id),
                    )
                  }
                />
                {c.name}
              </label>
            ))}
          </fieldset>
          <p className="mt-4 text-sm text-typography-600">
            {strings.dropHere} {strings.or}
          </p>
          <button
            type="button"
            disabled={!targets.length}
            onClick={() => inputRef.current?.click()}
            className="mt-2 inline-flex items-center gap-2 rounded bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500"
          >
            <FileUp size={14} aria-hidden /> {en.contextLibrary.drop.chooseFiles}
          </button>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={DOCUMENT_ACCEPT}
            className="hidden"
            onChange={event => {
              const chosen = Array.from(event.target.files ?? []);
              event.target.value = "";
              if (chosen.length) onFiles(chosen, targets);
            }}
          />
        </>
      )}
      {canEdit && (
        <div className="mt-4">
          <button
            type="button"
            onClick={onWrite}
            className="text-sm text-primary-600 underline-offset-2 hover:underline"
          >
            {strings.orWrite}
          </button>
        </div>
      )}
    </section>
  );
};

/* ── The one Add button ──────────────────────────────────────────────── */

export type AddChoice = "upload" | "entry" | "bulk";

export const AddMenu: React.FC<{
  canUpload: boolean;
  canWrite: boolean;
  onChoose: (choice: AddChoice) => void;
}> = ({ canUpload, canWrite, onChoose }) => {
  const strings = en.contextLibrary.add;
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    menuRef.current?.querySelector<HTMLButtonElement>("[role=menuitem]:not([disabled])")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const items = Array.from(
          menuRef.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]:not([disabled])") ??
            [],
        );
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        const next =
          items[(index + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length];
        next?.focus();
      }
    };
    const onClick = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node) && event.target !== buttonRef.current) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  const items: Array<{
    id: AddChoice;
    label: string;
    hint: string;
    icon: typeof Plus;
    enabled: boolean;
  }> = [
    {
      id: "upload",
      label: strings.upload,
      hint: strings.uploadHint,
      icon: FilePlus2,
      enabled: canUpload,
    },
    {
      id: "entry",
      label: strings.entry,
      hint: strings.entryHint,
      icon: PenLine,
      enabled: canWrite,
    },
    { id: "bulk", label: strings.bulk, hint: strings.bulkHint, icon: Table2, enabled: canWrite },
  ];

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
        className="inline-flex h-10 items-center gap-2 rounded bg-primary-600 px-4 text-sm font-medium text-white hover:bg-primary-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
        data-testid="cl-add-button"
      >
        <Plus size={16} aria-hidden /> {strings.button}
        <ChevronDown size={14} aria-hidden />
      </button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={strings.menuLabel}
          className="absolute right-0 z-40 mt-1 w-72 rounded-lg border border-border-light bg-white py-1 shadow-lg"
        >
          {items.map(item => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              disabled={!item.enabled}
              onClick={() => {
                setOpen(false);
                buttonRef.current?.focus();
                onChoose(item.id);
              }}
              className="flex w-full items-start gap-3 px-3 py-2 text-left hover:bg-neutral-100 focus:bg-neutral-100 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            >
              <item.icon size={16} aria-hidden className="mt-0.5 shrink-0 text-typography-600" />
              <span>
                <span className="block text-sm font-medium">{item.label}</span>
                <span className="block text-xs text-typography-600">{item.hint}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
