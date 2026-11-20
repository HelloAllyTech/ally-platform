import React, { useState } from "react";

import { AutoExpandableTextarea, Button } from "@ally-ui-mono/ui-shared";
import { en } from "@constants";

interface ChatComposerProps {
  onSend: (text: string) => void;
  onStop: () => void;
  isStreaming: boolean;
  disabled?: boolean;
  placeholder?: string;
  /**
   * Leave the box editable while a reply streams, so the next message can be drafted (it still
   * can't be sent until the reply lands). The character interview works this way; Builder and
   * Course Copilot lock the box until the turn ends.
   */
  editableWhileStreaming?: boolean;
  /** Drop the top border when the page draws one around a footer the composer sits in. */
  borderless?: boolean;
}

/** Sized to its label, so the reply box keeps the width (Carbon's default min-width is wide). */
const BUTTON_CLASS = "shrink-0 !min-w-[5.5rem] !justify-center !px-4";

/**
 * The free-text way in — shared by Builder, Course Copilot and the character interview. Most turns
 * are answered from a question card instead; this is for what the agent hasn't thought to ask, and
 * for edits, which is why the placeholder can be supplied per feature or session state.
 *
 * Enter sends, Shift+Enter adds a newline, and while a turn streams the button becomes Stop (the
 * partial text is kept and marked as stopped, never thrown away).
 */
export const ChatComposer: React.FC<ChatComposerProps> = ({
  onSend,
  onStop,
  isStreaming,
  disabled = false,
  placeholder,
  editableWhileStreaming = false,
  borderless = false,
}) => {
  const [value, setValue] = useState("");
  const strings = en.agentChat.chat;

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed || isStreaming || disabled) return;
    setValue("");
    onSend(trimmed);
  };

  return (
    <div
      className={`flex items-end gap-3 bg-white px-4 py-3 ${
        borderless ? "" : "border-t border-neutral-200"
      }`}
    >
      {/* The shared textarea is built for inline editing (no padding, pulled up 8px); a chat box
          needs its own frame, padding and a height that lines up with the button beside it. */}
      <AutoExpandableTextarea
        id="agent-chat-composer"
        value={value}
        onChange={setValue}
        placeholder={placeholder ?? strings.placeholder}
        disabled={disabled || (isStreaming && !editableWhileStreaming)}
        minHeight={40}
        className="!mt-0 block rounded border border-neutral-300 bg-white !px-3 !py-[9px] !leading-5 focus:border-primary-500 disabled:!bg-neutral-50 disabled:text-typography-500"
        maxLines={6}
        onKeyDown={(event: React.KeyboardEvent<HTMLTextAreaElement>) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            submit();
          }
        }}
      />
      {isStreaming ? (
        <Button kind="danger--tertiary" size="md" className={BUTTON_CLASS} onClick={onStop}>
          {strings.stop}
        </Button>
      ) : (
        <Button
          kind="primary"
          size="md"
          className={BUTTON_CLASS}
          disabled={disabled || !value.trim()}
          onClick={submit}
        >
          {strings.send}
        </Button>
      )}
    </div>
  );
};
