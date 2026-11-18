import { FC, useEffect, useRef, useState } from "react";

import { type Editor, useEditorState } from "@tiptap/react";

import {
  CALLOUT_KINDS,
  CALLOUT_NODE,
  CALLOUT_STYLES,
  CalloutKind,
  isCalloutKind,
} from "./calloutNode";

/** The small round icon each kind of box carries, here and in the box itself. */
export const CalloutIcon: FC<{ kind: CalloutKind }> = ({ kind }) => (
  <span
    aria-hidden="true"
    className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold leading-none text-white"
    style={{ backgroundColor: CALLOUT_STYLES[kind].iconBackground }}
  >
    {CALLOUT_STYLES[kind].glyph}
  </span>
);

/**
 * "Highlight box ▾": puts the selected paragraphs in a Try saying / Good to
 * know / Watch out box. With the cursor inside a box, the same menu shows
 * which kind it is, switches it to another, or removes it.
 */
export const CalloutMenu: FC<{ editor: Editor }> = ({ editor }) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // The editor does not re-render its toolbar on every transaction, so read
  // "is the cursor in a box?" straight from the editor's state.
  const activeKind = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      if (!current?.isActive(CALLOUT_NODE)) return null;
      const kind = current.getAttributes(CALLOUT_NODE).kind;
      return isCalloutKind(kind) ? kind : null;
    },
  });

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as globalThis.Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const choose = (kind: CalloutKind) => {
    editor.chain().focus().setCallout(kind).run();
    setOpen(false);
  };

  const remove = () => {
    editor.chain().focus().unsetCallout().run();
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Highlight box"
        className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors ${
          activeKind
            ? "bg-primary-100 text-primary-600"
            : "text-typography-600 hover:bg-gray-100 hover:text-typography-800"
        }`}
      >
        {activeKind && <CalloutIcon kind={activeKind} />}
        Highlight box
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Highlight box"
          className="absolute left-0 top-full z-20 mt-1 flex min-w-[210px] flex-col rounded-md border border-border-light bg-white py-1 shadow-lg"
        >
          {CALLOUT_KINDS.map(kind => (
            <button
              key={kind}
              type="button"
              role="menuitemradio"
              aria-checked={activeKind === kind}
              onClick={() => choose(kind)}
              className="flex items-center gap-2 px-3 py-1.5 text-left text-sm text-typography-800 hover:bg-secondary-50"
            >
              <CalloutIcon kind={kind} />
              <span className="flex-1">{CALLOUT_STYLES[kind].title}</span>
              {activeKind === kind && (
                <span aria-hidden="true" className="text-primary-500">
                  ✓
                </span>
              )}
            </button>
          ))}
          {activeKind && (
            <>
              <div className="my-1 h-px bg-border-light" />
              <button
                type="button"
                role="menuitem"
                onClick={remove}
                className="whitespace-nowrap px-3 py-1.5 text-left text-sm text-destructive-500 hover:bg-secondary-50"
              >
                Remove box (keep the text)
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
};
