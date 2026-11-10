import React, { useMemo, useRef, useState } from "react";

import { useGetBotImagesQuery, useTestChatbotMutation } from "@api";
import { Button, PhonePreview } from "@components/v2";
import { ChatbotTestStreamUnavailable, useChatbotTestStream } from "@hooks/useChatbotTestStream";
import type { BotPageView, Chatbot, TestChatbotResponse } from "@types";

import { HOME } from "./copy";
import { pickCopy } from "../../botPage/copy";
import { Chat, ChatItem, PendingReply } from "../../botPage/screens/Chat";
import "../../botPage/page.css";
import { surfaceProps } from "../../botPage/theme";
import { readableAccent } from "../../utils/colourPicks";

import type { PublicBotPage, StatusCode } from "../../botPage/types";

const STATUS: readonly StatusCode[] = [
  "thinking",
  "searching",
  "found",
  "checking",
  "rewriting",
  "writing",
];
/** The test endpoint accepts at most 20 earlier messages, as WhatsApp keeps. */
const MAX_HISTORY = 20;

/** The page as visitors see it, from the saved settings and the brand's images. */
const usePreviewPage = (bot: Chatbot, view: BotPageView | null): PublicBotPage | null => {
  const { data: images } = useGetBotImagesQuery(bot.id);
  return useMemo(() => {
    if (!view) return null;
    const { branding, brand } = view.settings;
    const byId = new Map((images ?? []).map(image => [image.id, image]));
    const logo = brand.logo ? byId.get(brand.logo) : undefined;
    const cover = brand.coverImage ? byId.get(brand.coverImage) : undefined;
    const accent = readableAccent(brand.accent ?? branding.accentColour);
    const logoSrc = logo?.urls[256] ?? branding.logoUrl ?? null;
    return {
      slug: view.slug,
      access: view.access,
      branding: {
        ...branding,
        logoUrl: logoSrc,
        accentColour: accent,
        look: {
          headingStyle: brand.headingStyle,
          theme: brand.theme,
          accent,
          logo: logoSrc
            ? { src: logoSrc, srcset: "", width: 256, height: 256, alt: logo?.alt ?? "" }
            : null,
          cover: cover
            ? { src: cover.urls[768], srcset: "", width: 768, height: 432, alt: cover.alt ?? "" }
            : null,
        },
      },
      suggestedQuestions: view.settings.suggestedQuestions,
      prechat: [],
      maxMessageChars: view.settings.limits.maxMessageChars,
      language: view.settings.language,
      turnstileSiteKey: null,
    };
  }, [images, view]);
};

const citationsOf = (result: TestChatbotResponse) =>
  result.citations.map(c => ({ title: c.document_title, url: null }));

/**
 * Try it (chunk 20d): the real bot page chat, in the page's brand, inside a phone, answering
 * through the same test stream Preview used (so answers, sources and the crisis path match the
 * live page). Nothing here is stored as a conversation.
 */
export const TryIt: React.FC<{ bot: Chatbot; page: BotPageView | null; onClose: () => void }> = ({
  bot,
  page,
  onClose,
}) => {
  const preview = usePreviewPage(bot, page);
  const copy = useMemo(() => pickCopy(preview?.language ?? "en", "en"), [preview?.language]);
  const stream = useChatbotTestStream();
  const [test] = useTestChatbotMutation();
  const [messages, setMessages] = useState<ChatItem[]>([]);
  const [pending, setPending] = useState<PendingReply | null>(null);
  const [error, setError] = useState<string | null>(null);
  const conversation = useRef<string | undefined>();

  const send = async (text: string) => {
    const history = messages.slice(-MAX_HISTORY).map(m => ({ role: m.role, content: m.text }));
    setMessages(list => [...list, { id: `u${Date.now()}`, role: "user", text, citations: [] }]);
    setPending({ status: "thinking", text: "" });
    setError(null);
    const request = { id: bot.id, message: text, history, conversationId: conversation.current };
    let arrived = "";
    try {
      let result: TestChatbotResponse;
      try {
        result = await stream.run(request, {
          onStatus: status =>
            setPending(
              p =>
                p && {
                  ...p,
                  status: STATUS.includes(status.code as StatusCode)
                    ? (status.code as StatusCode)
                    : p.status,
                },
            ),
          onStep: () => undefined,
          onToken: piece => {
            arrived += piece;
            setPending(p => p && { ...p, text: arrived });
          },
        });
      } catch (failure) {
        if (!(failure instanceof ChatbotTestStreamUnavailable)) throw failure;
        result = await test(request).unwrap();
      }
      conversation.current = result.conversationId;
      setMessages(list => [
        ...list,
        {
          id: `a${Date.now()}`,
          role: "assistant",
          text: result.reply,
          citations: citationsOf(result),
          // As on the page: the thumbs show under the assistant's own answers (chunk Q2a).
          rateable: ["rag", "declined", "clarified"].includes(String(result.handledBy)),
        },
      ]);
    } catch {
      setError(copy.errors.INTERNAL);
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="ally-home__try" data-testid="try-it">
      <div className="ally-home__panel-head">
        <div>
          <h2 className="ally-heading ally-home__panel-title">{HOME.tryPanel.title}</h2>
          <p className="ally-small">{HOME.tryPanel.hint}</p>
        </div>
        <div className="ally-btn-row">
          {messages.length > 0 && (
            <Button
              onClick={() => {
                stream.cancel();
                setMessages([]);
                conversation.current = undefined;
              }}
            >
              {HOME.tryPanel.newChat}
            </Button>
          )}
          <Button onClick={onClose}>{HOME.tryPanel.close}</Button>
        </div>
      </div>
      {preview && (
        <PhonePreview label={HOME.tryPanel.title}>
          <div
            {...surfaceProps(preview.branding)}
            className="brand-surface bp-root ally-home__try-page"
          >
            <Chat
              page={preview}
              copy={copy}
              messages={messages}
              pending={pending}
              busy={pending !== null}
              error={error}
              onSend={text => void send(text)}
              onNewChat={() => {
                setMessages([]);
                conversation.current = undefined;
              }}
              // Shown so the owner sees what visitors see; Preview stores no messages, so a
              // rating here isn't counted (chunk Q2a).
              onRate={() => undefined}
            />
          </div>
        </PhonePreview>
      )}
    </div>
  );
};
