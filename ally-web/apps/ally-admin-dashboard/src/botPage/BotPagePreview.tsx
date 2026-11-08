import { useMemo } from "react";

import { FocusHeadings } from "./components/parts";
import { pickCopy } from "./copy";
import { Chat } from "./screens/Chat";
import { Cover } from "./screens/Cover";
import { themeVars } from "./theme";

import type { PublicBotPage } from "./types";

/**
 * The bot page as a visitor would see it, drawn from the same screens, for the dashboard's live
 * preview in a phone frame. It sends nothing: the chat shows a sample exchange.
 */
export function BotPagePreview({
  page,
  screen,
  sampleReply,
  statusLine,
}: {
  page: PublicBotPage;
  screen: "cover" | "chat";
  sampleReply: string;
  /** The header's status line, for example "Usually replies in seconds". */
  statusLine?: string;
}) {
  const copy = useMemo(() => pickCopy(page.language, "en"), [page.language]);
  const noop = () => undefined;
  return (
    <FocusHeadings.Provider value={false}>
      <div
        aria-hidden="true"
        style={themeVars(page.branding.accentColour)}
        className="pointer-events-none h-full overflow-hidden bg-stone-50 font-sans text-stone-900"
      >
        {screen === "cover" ? (
          <Cover page={page} copy={copy} onStart={noop} />
        ) : (
          <Chat
            page={page}
            copy={copy}
            messages={
              page.suggestedQuestions[0]
                ? [
                    { id: "q", role: "user", text: page.suggestedQuestions[0], citations: [] },
                    { id: "a", role: "assistant", text: sampleReply, citations: [] },
                  ]
                : [{ id: "a", role: "assistant", text: sampleReply, citations: [] }]
            }
            pending={null}
            onSend={noop}
            onNewChat={noop}
            statusLine={statusLine}
          />
        )}
      </div>
    </FocusHeadings.Provider>
  );
}
