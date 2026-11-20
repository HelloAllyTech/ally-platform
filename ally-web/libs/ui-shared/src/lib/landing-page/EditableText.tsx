import { ClipboardEvent, createElement, FC, KeyboardEvent, useEffect, useRef } from "react";

/**
 * `innerText` keeps line breaks; where a browser lacks it (a test DOM) `textContent`
 * stands in. Typed loosely because the type system says every element has it.
 */
const hasInnerText = (element: HTMLElement): boolean =>
  typeof (element as { innerText?: unknown }).innerText === "string";

const readText = (element: HTMLElement): string =>
  hasInnerText(element) ? element.innerText : (element.textContent ?? "");

const writeText = (element: HTMLElement, text: string) => {
  if (hasInnerText(element)) element.innerText = text;
  else element.textContent = text;
};

interface EditableTextProps {
  /** The text in the language being shown. */
  value: string;
  /** Called once, when the person leaves the text, with what they typed. */
  onChange: (next: string) => void;
  /** Whether the text can be edited here. False is the page as visitors see it. */
  editable: boolean;
  /** Shown faintly while the text is empty and being edited. */
  placeholder: string;
  tag?: "h1" | "h2" | "p" | "span" | "div";
  className?: string;
  /** Allow line breaks (Shift+Enter). Otherwise Enter finishes the edit. */
  multiline?: boolean;
  /** Stops the editor's own click (for example on a card) from running. */
  stopClick?: boolean;
}

/**
 * Text you can click to edit where it stands. Plain text only: pasted markup
 * is flattened to its text, and the value is read back with `innerText`, so
 * nothing but characters ever leaves this component. Edits are committed when
 * focus leaves, not on every keystroke, which keeps the caret where it is.
 */
export const EditableText: FC<EditableTextProps> = ({
  value,
  onChange,
  editable,
  placeholder,
  tag = "span",
  className,
  multiline = false,
  stopClick = false,
}) => {
  const ref = useRef<HTMLElement | null>(null);

  // Keep the box in step with the value, unless the person is typing in it.
  useEffect(() => {
    const element = ref.current;
    if (element && document.activeElement !== element && readText(element) !== value) {
      writeText(element, value);
    }
  }, [value, editable]);

  if (!editable) {
    return value ? createElement(tag, { className }, value) : null;
  }

  const commit = () => {
    const element = ref.current;
    if (!element) return;
    const next = readText(element)
      .replace(/\u00a0/g, " ")
      .trim();
    if (readText(element) !== next) writeText(element, next);
    if (next !== value) onChange(next);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Enter" && !(multiline && event.shiftKey)) {
      event.preventDefault();
      ref.current?.blur();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      if (ref.current) writeText(ref.current, value);
      ref.current?.blur();
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLElement>) => {
    event.preventDefault();
    const text = event.clipboardData.getData("text/plain");
    const flat = multiline ? text : text.replace(/\s*\n\s*/g, " ");
    document.execCommand?.("insertText", false, flat);
  };

  return createElement(tag, {
    ref,
    className: `lp-editable ${className ?? ""}`.trim(),
    contentEditable: true,
    suppressContentEditableWarning: true,
    role: "textbox",
    "aria-label": placeholder,
    "aria-multiline": multiline,
    "data-placeholder": placeholder,
    spellCheck: true,
    onBlur: commit,
    onKeyDown,
    onPaste,
    onClick: stopClick
      ? (event: { stopPropagation: () => void }) => event.stopPropagation()
      : undefined,
  });
};
