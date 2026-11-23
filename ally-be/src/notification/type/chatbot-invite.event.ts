/**
 * Emitted (with `emitAsync`) by `ChatbotInvitesService` when an owner invites an email to a
 * chatbot's team (Stage 1b); `NotificationEventConsumer` sends the email and returns whether it
 * went. The link carries the invite token: never log it.
 */
export const CHATBOT_INVITE_CREATED_EVENT = 'chatbot.invite.created';

export interface ChatbotInviteCreatedEvent {
  to: string;
  chatbotName: string;
  inviterName: string;
  /** Role names, e.g. ['editor', 'responder']. */
  roles: string[];
  link: string;
  days: number;
}
