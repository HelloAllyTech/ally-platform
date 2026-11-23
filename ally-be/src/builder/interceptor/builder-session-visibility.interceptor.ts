import {
  CallHandler,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NestInterceptor,
  NotFoundException,
  Optional,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PlanSettingsService } from 'src/product-planning/service/plan-settings.service';
import { RoadmapRoleService } from 'src/product-planning/service/roadmap-role.service';
import {
  roleAtLeast,
  RoadmapRole,
} from 'src/product-planning/util/roadmap-role.util';
import {
  BuilderSessionKind,
  BuilderSessionVisibility,
} from '../enum/builder.enum';
import { Observable } from 'rxjs';
import {
  BuilderSessionRepository,
  isSessionVisibleTo,
} from '../repository/builder-session.repository';

/**
 * Roadmap v2 (D13, §5.7a): the writes on a shared plan session that are not
 * the lead's. An answer to an agent question, a comment, or the settler's
 * "Use this answer". Marked on the handler; everything unmarked stays the
 * lead's (or, with roadmap_v2 on, an Owner's).
 */
export type PlanParticipantWriteKind = 'answer' | 'comment' | 'settle';
export const PLAN_PARTICIPANT_WRITE = 'builder:planParticipantWrite';
export const PlanParticipantWrite = (kind: PlanParticipantWriteKind) =>
  SetMetadata(PLAN_PARTICIPANT_WRITE, kind);

/** The least Roadmap role each participant write needs (capabilitiesFor's answer/comment). */
const PARTICIPANT_FLOOR: Record<PlanParticipantWriteKind, RoadmapRole> = {
  answer: 'idea',
  comment: 'viewer',
  // The settler is checked in the service (lead, author before a lead, or Owner).
  settle: 'idea',
};

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
  constructor(
    private readonly sessionRepository: BuilderSessionRepository,
    /** Optional so the unit harness can build it with the repository alone. */
    @Optional() private readonly reflector?: Reflector,
    @Optional() private readonly roles?: RoadmapRoleService,
    @Optional() private readonly settings?: PlanSettingsService,
  ) {}

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

    // A plan is changed only through its own stage's rules (rev 5.2 §B.12):
    // a private draft through the roadmap's idea flow, a shared plan only by
    // its current lead. Reads stay open to everyone who may see the plan.
    //
    // Roadmap v2 (D13, §5.7a), only while roadmap_v2 is on: anyone with a
    // Roadmap role may post an answer (and a comment, and the settler their
    // choice) on a shared plan; every other write is the lead's or an Owner's.
    const method = String(request.method ?? 'GET').toUpperCase();
    if (facts.kind === BuilderSessionKind.PLAN && method !== 'GET') {
      if (facts.visibility === BuilderSessionVisibility.PRIVATE) {
        throw new ForbiddenException(
          'This idea is still private. Work on it from My ideas on the roadmap.',
        );
      }
      const participant = this.participantWrite(context);
      if (participant) {
        if (!(await this.roadmapV2On())) {
          throw new NotFoundException();
        }
        const role = (await this.roles?.roleOf(viewerId)) ?? 'none';
        if (!roleAtLeast(role, PARTICIPANT_FLOOR[participant])) {
          throw new ForbiddenException(
            'Your Roadmap role cannot post on this idea.',
          );
        }
        return next.handle();
      }
      if (
        facts.leadUserId !== viewerId &&
        (await this.roadmapV2On()) &&
        (await this.roles?.roleOf(viewerId)) === 'owner'
      ) {
        return next.handle();
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

  private participantWrite(
    context: ExecutionContext,
  ): PlanParticipantWriteKind | undefined {
    const handler =
      typeof context.getHandler === 'function' ? context.getHandler() : null;
    if (!handler || !this.reflector) return undefined;
    return this.reflector.get<PlanParticipantWriteKind | undefined>(
      PLAN_PARTICIPANT_WRITE,
      handler,
    );
  }

  /** A failure to read the flag counts as off: nothing changes for today's callers. */
  private async roadmapV2On(): Promise<boolean> {
    try {
      return !!(await this.settings?.getRoadmapV2())?.enabled;
    } catch {
      return false;
    }
  }
}
