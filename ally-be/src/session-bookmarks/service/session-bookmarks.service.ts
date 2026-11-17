import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { PostHog } from 'posthog-node';
import { Repository } from 'typeorm';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { LoggerService } from 'src/logger/logger.service';
import { userDistinctId } from 'src/posthog/posthog.util';
import {
  CreateSessionBookmarkDto,
  SessionBookmarkDto,
} from '../dto/create-session-bookmark.dto';
import { SessionBookmark } from '../entity/session-bookmark.entity';
import { SESSION_BOOKMARKS_ANALYTICS_EVENTS } from '../constants/session-bookmarks-analytics.constants';

const MAX_BOOKMARKS_PER_USER = 200;

@Injectable()
export class SessionBookmarksService {
  private readonly logger = LoggerService.getInstance(SessionBookmarksService.name);

  constructor(
    @InjectRepository(SessionBookmark)
    private readonly bookmarks: Repository<SessionBookmark>,
    private readonly posthog: PostHog,
  ) {}

  async create(dto: CreateSessionBookmarkDto): Promise<SessionBookmarkDto> {
    const userId = Number(ExecutionManager.getUserId());
    const tenantId = ExecutionManager.getTenantId();

    if (
      await this.bookmarks.exists({
        where: { userId, sessionId: dto.sessionId },
      })
    ) {
      throw new ConflictException('You have already saved this session');
    }
    if (
      (await this.bookmarks.count({ where: { userId } })) >=
      MAX_BOOKMARKS_PER_USER
    ) {
      throw new ConflictException(
        'You have reached the limit of saved sessions',
      );
    }

    const saved = await this.bookmarks.save(
      this.bookmarks.create({
        userId,
        tenantId,
        sessionId: dto.sessionId,
        note: dto.note?.trim() || null,
        source: dto.source ?? 'web',
      }),
    );
    this.captureBookmarkCreated(userId, saved.sessionId);
    return this.toDto(saved);
  }

  async list(): Promise<SessionBookmarkDto[]> {
    const userId = Number(ExecutionManager.getUserId());
    const rows = await this.bookmarks.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: MAX_BOOKMARKS_PER_USER,
    });
    return rows.map((row) => this.toDto(row));
  }

  async remove(id: string): Promise<void> {
    const userId = Number(ExecutionManager.getUserId());
    const result = await this.bookmarks.delete({ id, userId });
    if (!result.affected)
      throw new NotFoundException('Saved session not found');
  }

  /** Analytics must never fail the request. */
  private captureBookmarkCreated(userId: number, sessionId: string): void {
    try {
      this.posthog.capture({
        distinctId: userDistinctId(userId),
        event: SESSION_BOOKMARKS_ANALYTICS_EVENTS.CREATED,
        properties: { scenario_session_id: sessionId },
      });
    } catch (error) {
      this.logger.error(
        `Failed to capture ${SESSION_BOOKMARKS_ANALYTICS_EVENTS.CREATED} in PostHog: ${error}`,
      );
    }
  }

  private toDto(row: SessionBookmark): SessionBookmarkDto {
    return {
      id: row.id,
      sessionId: row.sessionId,
      note: row.note,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
