import {
  CallHandler,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NestInterceptor,
  NotFoundException,
} from '@nestjs/common';
import {
  BuilderSessionKind,
  BuilderSessionVisibility,
} from '../enum/builder.enum';
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
    if (!facts) return next.handle();

    // A caller let in by the Product Planning Lead toggle (not Builder's own)
    // reaches plan sessions only; Builder's own sessions stay Builder users'.
    if (request.viaAlternateToggle && facts.kind !== BuilderSessionKind.PLAN) {
      throw new NotFoundException('Builder session not found');
    }

    // A plan is changed only through its own stage's rules (rev 5.2 §B.12):
    // a private draft through the roadmap's idea flow, a shared plan only by
    // its current lead. Reads stay open to everyone who may see the plan.
    const method = String(request.method ?? 'GET').toUpperCase();
    if (facts.kind === BuilderSessionKind.PLAN && method !== 'GET') {
      if (facts.visibility === BuilderSessionVisibility.PRIVATE) {
        throw new ForbiddenException(
          'This idea is still private. Work on it from My ideas on the roadmap.',
        );
      }
      if (facts.leadUserId !== viewerId) {
        throw new ForbiddenException(
          facts.leadUserId
            ? 'Only this plan’s lead can change it.'
            : 'Take this plan on from the roadmap before changing it.',
        );
      }
    }
    return next.handle();
  }
}
