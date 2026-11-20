import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { BuilderDecisionService } from 'src/builder/service/builder-decision.service';
import { LoggerService } from 'src/logger/logger.service';
import { RoadmapItemLookupService } from '../item/roadmap-item-lookup.service';
import { RoadmapItemReadService } from '../item/roadmap-item-read.service';
import { RoadmapNotificationService } from '../service/roadmap-notification.service';

/** The longest message the planner sends the planning agent in one go. */
export const PLANNER_MESSAGE_MAX = 4000;

/**
 * What the Owner's Start planning says to the planning agent: the transcript
 * shows it as their words, and it is the turn that opens with the discovery
 * sweep and the situation brief. Short on purpose: the idea itself reaches
 * the agent through the session's hand-off.
 */
export function openingTurnMessage(code: string, title: string): string {
  const name = title.trim() ? `${code}: ${title.trim()}` : code;
  return (
    `Start planning ${name}. Look into what already exists for this idea, ` +
    'then send me your situation brief.'
  );
}

/**
 * Runs the planning agent from the idea page (audit 2026-11-19, rec 1).
 *
 * Before this, Start planning only wrote state and nothing on the Roadmap
 * pages could start a turn: the turn-stream route's only client was the old
 * Builder session page. Both doors here start a background turn through
 * BuilderDecisionService.startBackgroundTurn, which holds the same per-session
 * turn lock as the stream, so the two surfaces never interleave; the page
 * picks the reply up from its session poll and the item-changed event.
 */
@Injectable()
export class PlanTurnService {
  private readonly logger = LoggerService.getInstance(PlanTurnService.name);

  constructor(
    private readonly decisions: BuilderDecisionService,
    private readonly reader: RoadmapItemReadService,
    private readonly lookup: RoadmapItemLookupService,
    private readonly broadcast: RoadmapNotificationService,
  ) {}

  /**
   * The opening turn, queued as Start planning's last step. Fire and forget:
   * a busy lock or a model failure must never fail Start planning, and the
   * planner's composer can always start the turn again.
   */
  queueOpeningTurn(
    sessionId: string,
    userId: number,
    code: string,
    title: string,
  ): void {
    void this.decisions
      .startBackgroundTurn(sessionId, openingTurnMessage(code, title), userId)
      .then(() =>
        this.broadcast.emit({
          kind: 'ITEM_CHANGED',
          actorId: userId,
          code,
          fields: ['answers'],
        }),
      )
      .catch((error: unknown) =>
        this.logger.warn(
          `[PLAN_TURN] opening turn for ${code} did not start: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ),
      );
  }

  /**
   * The planner's message to the planning agent: an Owner, or the builder
   * already assigned, while the idea is being planned (`can.workPlan`). Starts
   * a turn now; a turn already running answers 409 so the page can say so.
   */
  async send(
    userId: number,
    code: string,
    text: string | undefined,
  ): Promise<{ started: true }> {
    const item = await this.reader.detail(userId, code);
    if (!item.can.workPlan) {
      throw new ForbiddenException(
        item.shownStage === 'planning'
          ? 'Only an Owner or the builder assigned to this idea runs its planning agent.'
          : 'The planning agent runs while an idea is being planned.',
      );
    }
    // Nothing typed is "Start the planning agent": the opening turn, for an
    // idea whose planning started before Start planning queued one.
    const message =
      String(text ?? '').trim() || openingTurnMessage(item.code, item.title);
    if (message.length > PLANNER_MESSAGE_MAX) {
      throw new UnprocessableEntityException(
        `Keep it under ${PLANNER_MESSAGE_MAX} characters.`,
      );
    }
    const ref = await this.lookup.get(code);
    if (!ref.builderSessionId) {
      throw new ConflictException('This idea has no plan yet.');
    }
    await this.decisions.startBackgroundTurn(
      ref.builderSessionId,
      message,
      userId,
    );
    this.broadcast.emit({
      kind: 'ITEM_CHANGED',
      actorId: userId,
      code: ref.code,
      fields: ['answers'],
    });
    return { started: true };
  }
}
