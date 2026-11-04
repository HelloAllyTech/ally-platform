import { createContext, useContext } from "react";

/**
 * The chatbot the current tab is about, for the tabs and panels deep inside the chatbot page.
 * Undefined = every bot (the platform-wide views). Every list, chart and row action passes it to
 * the API as `chatbotId`.
 */
export const ChatbotContext = createContext<string | undefined>(undefined);
export const useChatbotId = () => useContext(ChatbotContext);
