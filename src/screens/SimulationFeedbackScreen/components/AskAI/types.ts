export enum ChatMessageRole {
  USER = 'user',
  AI = 'ai',
}

export interface AskAIChatMessage {
  id: string;
  role: ChatMessageRole;
  content: string;
  /** True while the AI response is being streamed character-by-character */
  isStreaming?: boolean;
}
