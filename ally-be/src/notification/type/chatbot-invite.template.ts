import type { ChatbotInviteCreatedEvent } from './chatbot-invite.event';

const ROLE_LABEL: Record<string, string> = {
  owner: 'an owner',
  editor: 'an editor',
  responder: 'a responder',
  viewer: 'a viewer',
};

function rolesText(roles: string[]): string {
  const labels = roles.map((r) => ROLE_LABEL[r] ?? r);
  if (labels.length <= 1) return labels[0] ?? 'a member';
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

/** The chatbot invite email (Stage 1b). Plain text. */
// COPY: needs approval
export function chatbotInviteEmail(event: ChatbotInviteCreatedEvent): {
  subject: string;
  body: string;
} {
  return {
    subject: `You're invited to help with ${event.chatbotName}`,
    body: `${event.inviterName} has invited you to the chatbot "${event.chatbotName}" on Ally, as ${rolesText(event.roles)}.

Accept the invite here:
${event.link}

The invite works only for this email address and expires in ${event.days} days. If you weren't expecting it, you can ignore this email.

The Ally Team`,
  };
}
