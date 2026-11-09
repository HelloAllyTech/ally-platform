import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  NotFoundException,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import {
  BuilderSessionRepository,
  isSessionVisibleTo,
} from '../repository/builder-session.repository';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Refuses a PRIVATE session to anyone but its author, on every Builder route
 * that names one by `:sessionId`.
 *
 * An interceptor rather than a guard because Builder's auth runs in route-level
 * guards (@RequireFeatureToggle), and Nest runs controller-level guards first —
 * a class guard would see no `request.user`. Interceptors run after every guard.
 *
 * Applied to the whole controller so a new `:sessionId` route is covered the
 * day it is written. 404, not 403, so a private session's id cannot be probed
 * (the same choice as roadmap idea drafts). A missing session passes through:
 * the handler's own lookup already answers 404 for it.
 */
@Injectable()
export class BuilderSessionVisibilityInterceptor implements NestInterceptor {
  constructor(private readonly sessionRepository: BuilderSessionRepository) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    if (context.getType() !== 'http') return next.handle();
    const request = context.switchToHttp().getRequest();
    const sessionId: unknown = request.params?.sessionId;
    if (typeof sessionId !== 'string' || !sessionId) return next.handle();

    const viewerId: number | undefined = request.user?.id;
    // Not a UUID: ParseUUIDPipe answers 400 after this; querying would be a
    // Postgres error. Never a catch-all: a failed lookup must fail closed.
    if (!UUID.test(sessionId)) return next.handle();
    const facts = await this.sessionRepository.findVisibilityFacts(sessionId);
    if (
      facts &&
      (viewerId === undefined || !isSessionVisibleTo(facts, viewerId))
    ) {
      throw new NotFoundException('Builder session not found');
    }
    return next.handle();
  }
}
