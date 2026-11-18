import { createMiddleware } from 'langchain';
import { isTool } from '../service/analytical-agent-trace';

/**
 * Datalyze moves a workflow forward with a signed "task token": every tool
 * result ends with `task: \`<token>\``, and the next `datalyze_next_step` call
 * must send it back unchanged. The token is long (it carries the request and
 * the sections already sent, so it grows with each step), and a model that
 * copies it by hand sometimes gets a character wrong, which fails the signature
 * check ("That task token is not valid") and costs retries that fail the same way.
 *
 * So the model does not copy it. This middleware reads the newest token out of
 * each Datalyze result and writes it into the next `datalyze_next_step` call,
 * whatever the model put in `task`. One instance per agent run: the token
 * belongs to that run's workflow.
 */

/** What the prompt tells the model to send as `task`; the real value is filled in here. */
export const TASK_TOKEN_PLACEHOLDER = 'use-latest-token';

const TOKEN_PATTERN = /\btask:\s*`([^`\s]+)`/;

/** Plain text of a tool result: a string, or the text blocks of a content array. */
function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block) =>
      typeof block === 'string'
        ? block
        : ((block as { text?: string })?.text ?? ''),
    )
    .join('\n');
}

/** The task token a Datalyze result hands over, or null when it has none. */
export function extractTaskToken(content: unknown): string | null {
  return TOKEN_PATTERN.exec(contentText(content))?.[1] ?? null;
}

export function createDatalyzeTaskTokenMiddleware() {
  let latest: string | null = null;

  return createMiddleware({
    name: 'DatalyzeTaskToken',
    wrapToolCall: async (request, handler) => {
      const name = request.toolCall.name;
      const isDatalyze = name.startsWith('datalyze_');
      if (isDatalyze && isTool(name, 'next_step') && latest) {
        const sent = request.toolCall.args?.task;
        if (sent !== latest) {
          if (sent !== TASK_TOKEN_PLACEHOLDER) {
            console.warn(
              'datalyze_next_step: replaced the task token the model sent with the latest one',
            );
          }
          request = {
            ...request,
            toolCall: {
              ...request.toolCall,
              args: { ...request.toolCall.args, task: latest },
            },
          };
        }
      }

      const result = await handler(request);

      if (isDatalyze && 'content' in result) {
        const token = extractTaskToken(result.content);
        if (token) latest = token;
      }
      return result;
    },
  });
}
