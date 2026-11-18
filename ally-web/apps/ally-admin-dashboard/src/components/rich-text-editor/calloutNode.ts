import { mergeAttributes, Node } from "@tiptap/core";

export const CALLOUT_NODE = "callout";
export const CALLOUT_MARKER_ATTR = "data-ally-callout";

export const CALLOUT_KINDS = ["say", "info", "warn"] as const;
export type CalloutKind = (typeof CALLOUT_KINDS)[number];

export const isCalloutKind = (value: unknown): value is CalloutKind =>
  typeof value === "string" && (CALLOUT_KINDS as readonly string[]).includes(value);

interface CalloutStyle {
  /** Toolbar menu entry. */
  title: string;
  /** The box's own heading, as the learner sees it. */
  label: string;
  /** The glyph in the round icon. */
  glyph: string;
  background: string;
  iconBackground: string;
  labelColor: string;
  /** Body text colour; absent = the editor's normal text colour. */
  textColor?: string;
}

/**
 * One palette for every surface that draws a highlight box — the learner
 * apps use the same values, so what the author sees here is what the reader
 * gets.
 */
export const CALLOUT_STYLES: Record<CalloutKind, CalloutStyle> = {
  say: {
    title: "Try saying",
    label: "TRY SAYING",
    glyph: "“",
    background: "#EEF5EE",
    iconBackground: "#2F6B3B",
    labelColor: "#2F6B3B",
    textColor: "#1F3A24",
  },
  info: {
    title: "Good to know",
    label: "GOOD TO KNOW",
    glyph: "i",
    background: "#EBF0FA",
    iconBackground: "#264D8E",
    labelColor: "#264D8E",
  },
  warn: {
    title: "Watch out",
    label: "WATCH OUT",
    glyph: "!",
    background: "#FFF5E5",
    iconBackground: "#A2620B",
    labelColor: "#8A5309",
  },
};

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    callout: {
      /**
       * Put the selected paragraphs in a highlight box, or — inside a box
       * already — switch that box to `kind`. Where the selection cannot be
       * wrapped (a heading, say), an empty box is dropped in instead.
       */
      setCallout: (kind: CalloutKind) => ReturnType;
      /** Take the box away, keeping its paragraphs. */
      unsetCallout: () => ReturnType;
    };
  }
}

/**
 * A highlight box in an article: "Try saying", "Good to know" or "Watch out".
 *
 * Unlike the question placeholder this one holds real content — one or more
 * paragraphs with inline formatting — because the text *is* the point. What
 * the marker adds is only the kind, carried on the same `data-ally-*` marker
 * div convention the article already uses for questions, so it serialises to
 * exactly `<div data-ally-callout="say"><p>…</p></div>`: what the server
 * validates and every learner player renders.
 *
 * A div whose kind is not one of the three is not read as a box at all; its
 * text falls through as ordinary paragraphs rather than becoming a box the
 * learner apps would not know how to draw.
 */
export const CalloutNode = Node.create({
  name: CALLOUT_NODE,
  group: "block",
  content: "paragraph+",
  defining: true,

  addAttributes() {
    return {
      kind: {
        default: "info",
        parseHTML: element => element.getAttribute(CALLOUT_MARKER_ATTR),
        renderHTML: attributes => ({ [CALLOUT_MARKER_ATTR]: attributes.kind }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: `div[${CALLOUT_MARKER_ATTR}]`,
        getAttrs: element =>
          isCalloutKind((element as HTMLElement).getAttribute(CALLOUT_MARKER_ATTR)) ? null : false,
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes), 0];
  },

  addCommands() {
    return {
      setCallout:
        kind =>
        ({ editor, commands }) => {
          if (editor.isActive(CALLOUT_NODE)) {
            return commands.updateAttributes(CALLOUT_NODE, { kind });
          }
          if (commands.wrapIn(CALLOUT_NODE, { kind })) return true;
          return commands.insertContent({
            type: CALLOUT_NODE,
            attrs: { kind },
            content: [{ type: "paragraph" }],
          });
        },
      unsetCallout:
        () =>
        ({ commands }) =>
          commands.lift(CALLOUT_NODE),
    };
  },

  /**
   * A coloured box with its label, so the author sees roughly what the reader
   * will. The label is drawn by the view only — it is not part of the
   * document, and so never reaches the HTML.
   */
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement("div");
      dom.className = "my-2 rounded-lg px-4 py-3";

      const header = document.createElement("div");
      header.contentEditable = "false";
      header.className = "mb-1 flex items-center gap-2 select-none";

      const icon = document.createElement("span");
      icon.className =
        "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white";
      const label = document.createElement("span");
      label.style.fontSize = "11px";
      label.style.fontWeight = "600";
      label.style.letterSpacing = "0.08em";
      header.append(icon, label);

      const contentDOM = document.createElement("div");
      dom.append(header, contentDOM);

      const apply = (kind: unknown) => {
        const safeKind: CalloutKind = isCalloutKind(kind) ? kind : "info";
        const style = CALLOUT_STYLES[safeKind];
        dom.setAttribute(CALLOUT_MARKER_ATTR, safeKind);
        dom.style.backgroundColor = style.background;
        contentDOM.style.color = style.textColor ?? "";
        icon.style.backgroundColor = style.iconBackground;
        icon.textContent = style.glyph;
        label.style.color = style.labelColor;
        label.textContent = style.label;
      };
      apply(node.attrs.kind);

      return {
        dom,
        contentDOM,
        update: updated => {
          if (updated.type.name !== CALLOUT_NODE) return false;
          apply(updated.attrs.kind);
          return true;
        },
        // The header is decoration; only edits inside the paragraphs matter.
        ignoreMutation: mutation =>
          mutation.type !== "selection" && !contentDOM.contains(mutation.target),
      };
    };
  },
});
