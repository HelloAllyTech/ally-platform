import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { UsageChannel, UsageKind } from '../enum/billing.enum';
import { usageContext, UsageContext } from './usage-context';

const UUID = '[0-9a-fA-F-]{36}';
const CHATBOT_ROUTE = new RegExp(`/v\\d+/chatbots/(${UUID})(?:/|$|\\?)`);
const DRAFT_ROUTE = new RegExp(`/v\\d+/bot-drafts/(${UUID})(?:/|$|\\?)`);

/**
 * The usage context for owner screens (CR1 Part A): any request under an assistant
 * (`v1/chatbots/:id/…`) or a setup draft (`v1/bot-drafts/:id/…`) is owner-side work on it, so the
 * model calls it causes — setup, site reading, change by chat, checkups, How it works, Try it — are
 * attributed to that assistant or draft. Work the request starts and doesn't wait for (a checkup
 * that runs on after the response) keeps the context.
 *
 * Who pays (the creator) is resolved when the usage is recorded, from the assistant or draft.
 */
export function ownerUsageContextFor(url: string): UsageContext | null {
  const chatbot = CHATBOT_ROUTE.exec(url);
  if (chatbot) {
    return {
      channel: UsageChannel.OWNER,
      runKind: UsageKind.TRY_IT,
      chatbotId: chatbot[1].toLowerCase(),
    };
  }
  const draft = DRAFT_ROUTE.exec(url);
  if (draft) {
    return {
      channel: UsageChannel.OWNER,
      runKind: UsageKind.TRY_IT,
      draftId: draft[1].toLowerCase(),
    };
  }
  return null;
}

@Injectable()
export class OwnerUsageInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const request = context.switchToHttp().getRequest<{
      originalUrl?: string;
      url?: string;
    }>();
    const owner = ownerUsageContextFor(
      request?.originalUrl ?? request?.url ?? '',
    );
    if (!owner) return next.handle();
    return new Observable((subscriber) =>
      usageContext.run(owner, () => {
        const subscription = next.handle().subscribe(subscriber);
        return () => subscription.unsubscribe();
      }),
    );
  }
}
