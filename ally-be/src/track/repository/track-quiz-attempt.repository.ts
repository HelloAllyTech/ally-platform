import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { TrackQuizAttempt } from '../entity/track-quiz-attempt.entity';

@Injectable()
export class TrackQuizAttemptRepository extends Repository<TrackQuizAttempt> {
  constructor(private readonly dataSource: DataSource) {
    super(TrackQuizAttempt, dataSource.createEntityManager());
  }

  async countByProgressId(trackItemProgressId: string): Promise<number> {
    return this.count({ where: { trackItemProgressId } });
  }

  /** Most recent attempt, used to tell a learner why the quiz isn't done. */
  async findLatestByProgressId(
    trackItemProgressId: string,
  ): Promise<TrackQuizAttempt | null> {
    return this.findOne({
      where: { trackItemProgressId },
      order: { attemptNumber: 'DESC' },
    });
  }
}
