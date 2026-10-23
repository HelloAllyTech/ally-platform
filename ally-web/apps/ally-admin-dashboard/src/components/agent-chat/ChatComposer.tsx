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
}

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
    <div className="flex items-end gap-2 border-t border-neutral-200 bg-white p-3">
      <AutoExpandableTextarea
        id="agent-chat-composer"
        value={value}
        onChange={setValue}
        placeholder={placeholder ?? strings.placeholder}
        disabled={disabled || (isStreaming && !editableWhileStreaming)}
        maxLines={6}
        onKeyDown={(event: React.KeyboardEvent<HTMLTextAreaElement>) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            submit();
          }
        }}
      />
      {isStreaming ? (
        <Button kind="danger--tertiary" size="md" onClick={onStop}>
          {strings.stop}
        </Button>
      ) : (
        <Button kind="primary" size="md" disabled={disabled || !value.trim()} onClick={submit}>
          {strings.send}
        </Button>
      )}
    </div>
  );
};
