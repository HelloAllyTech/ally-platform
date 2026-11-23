import type { BotPageCopy } from "./en";

/**
 * Words for the fixed notice block and the chat box that sits beside the pre-chat questions.
 * Kept apart from `en.ts` / `hi.ts` on purpose. The notice and disclaimer texts come from ally-be.
 */
export interface SafetyCopy {
  noticeLabel: string;
  questionsIntro: string;
  messageLabel: string;
  messagePlaceholder: string;
  send: string;
  sendFirst: string;
}

// COPY: needs approval
const en: SafetyCopy = {
  noticeLabel: "Before you start",
  questionsIntro: "Answer these so we can help you better. You can also just type your message.",
  messageLabel: "Or type your message now",
  messagePlaceholder: "Type your message",
  send: "Send message",
  sendFirst: "Send without answering",
};

// COPY: needs approval
const hi: SafetyCopy = {
  noticeLabel: "शुरू करने से पहले",
  questionsIntro:
    "इनका उत्तर दें ताकि हम आपकी बेहतर मदद कर सकें। आप चाहें तो सीधे अपना संदेश भी लिख सकते हैं।",
  messageLabel: "या अभी अपना संदेश लिखें",
  messagePlaceholder: "अपना संदेश लिखें",
  send: "संदेश भेजें",
  sendFirst: "उत्तर दिए बिना भेजें",
};

export const safetyCopy = (copy: BotPageCopy): SafetyCopy => (copy.lang === "hi" ? hi : en);
