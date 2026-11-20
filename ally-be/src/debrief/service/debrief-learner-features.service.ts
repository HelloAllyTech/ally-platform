import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { DebriefLearnerFeatureAccess } from '../entity/debrief-learner-feature-access.entity';
import { DebriefLearnerFeature } from '../enum/debrief-review.enum';

export interface LearnerFeaturePerson {
  userId: number;
  name: string;
  email: string;
  addedAt: string;
}

export interface LearnerFeatureView {
  feature: DebriefLearnerFeature;
  /** Everyone has it: the per-person list is then not consulted. */
  everyone: boolean;
  people: LearnerFeaturePerson[];
}

/**
 * Who has a learner-facing debrief feature (Debrief settings › Learner features). A person is
 * added by email; "everyone" is one row with no user. A read that fails answers "no": a feature
 * must never break the debrief itself.
 */
@Injectable()
export class DebriefLearnerFeaturesService {
  constructor(
    @InjectRepository(DebriefLearnerFeatureAccess)
    private readonly access: Repository<DebriefLearnerFeatureAccess>,
    private readonly dataSource: DataSource,
  ) {}

  async isEnabled(
    feature: DebriefLearnerFeature,
    userId: number,
  ): Promise<boolean> {
    try {
      const rows = await this.dataSource.query(
        `SELECT 1 FROM debrief_learner_feature_access
          WHERE feature = $1 AND ("userId" IS NULL OR "userId" = $2) LIMIT 1`,
        [feature, userId],
      );
      return rows.length > 0;
    } catch {
      return false;
    }
  }

  async view(feature: DebriefLearnerFeature): Promise<LearnerFeatureView> {
    const rows: Array<{
      userId: number | null;
      name: string | null;
      email: string | null;
      createdAt: Date;
    }> = await this.dataSource.query(
      `SELECT a."userId", u.name, u.email, a."createdAt"
         FROM debrief_learner_feature_access a
         LEFT JOIN users u ON u.id = a."userId"
        WHERE a.feature = $1
        ORDER BY a."createdAt" ASC`,
      [feature],
    );
    return {
      feature,
      everyone: rows.some((r) => r.userId === null),
      people: rows
        .filter((r) => r.userId !== null)
        .map((r) => ({
          userId: Number(r.userId),
          name: r.name ?? '',
          email: r.email ?? '',
          addedAt: new Date(r.createdAt).toISOString(),
        })),
    };
  }

  async grant(
    feature: DebriefLearnerFeature,
    email: string,
    addedBy: number,
  ): Promise<LearnerFeatureView> {
    const wanted = String(email ?? '')
      .trim()
      .toLowerCase();
    if (!wanted) throw new BadRequestException('Enter an email.');
    const [user] = await this.dataSource.query(
      `SELECT id FROM users WHERE lower(email) = $1 LIMIT 1`,
      [wanted],
    );
    if (!user) {
      throw new BadRequestException('No account has that email.');
    }
    await this.dataSource.query(
      `INSERT INTO debrief_learner_feature_access (feature, "userId", "addedBy")
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [feature, user.id, addedBy],
    );
    return this.view(feature);
  }

  async revoke(
    feature: DebriefLearnerFeature,
    userId: number,
  ): Promise<LearnerFeatureView> {
    await this.access.delete({ feature, userId });
    return this.view(feature);
  }

  async setEveryone(
    feature: DebriefLearnerFeature,
    on: boolean,
    addedBy: number,
  ): Promise<LearnerFeatureView> {
    if (on) {
      await this.dataSource.query(
        `INSERT INTO debrief_learner_feature_access (feature, "userId", "addedBy")
         VALUES ($1, NULL, $2) ON CONFLICT DO NOTHING`,
        [feature, addedBy],
      );
    } else {
      await this.dataSource.query(
        `DELETE FROM debrief_learner_feature_access WHERE feature = $1 AND "userId" IS NULL`,
        [feature],
      );
    }
    return this.view(feature);
  }
}
