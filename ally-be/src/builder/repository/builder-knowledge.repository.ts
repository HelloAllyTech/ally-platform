import { Injectable } from '@nestjs/common';
import { DataSource, In, Repository } from 'typeorm';
import { BuilderRepoMap } from '../entity/builder-repo-map.entity';
import { BuilderExemplar } from '../entity/builder-exemplar.entity';
import { BuilderRepoCatalog } from '../entity/builder-repo-catalog.entity';
import { BuilderEvidence } from '../entity/builder-evidence.entity';
import { BuilderExemplarOutcome } from '../enum/builder.enum';

@Injectable()
export class BuilderRepoMapRepository extends Repository<BuilderRepoMap> {
  constructor(dataSource: DataSource) {
    super(BuilderRepoMap, dataSource.createEntityManager());
  }

  findByRepo(repo: string): Promise<BuilderRepoMap | null> {
    return this.findOne({ where: { repo } });
  }

  listAll(): Promise<BuilderRepoMap[]> {
    return this.find({ order: { repo: 'ASC' } });
  }
}

@Injectable()
export class BuilderExemplarRepository extends Repository<BuilderExemplar> {
  constructor(dataSource: DataSource) {
    super(BuilderExemplar, dataSource.createEntityManager());
  }

  findBySession(sessionId: string): Promise<BuilderExemplar | null> {
    return this.findOne({ where: { sessionId } });
  }

  /**
   * Recent archived builds, as candidates for a re-rank.
   *
   * Deliberately not filtered to successes: "a similar build tried this and
   * the PR was closed unmerged" is more useful to the next attempt than any
   * number of wins, and a corpus of only successes would be flattering and
   * useless.
   */
  listCandidates(limit: number, repos?: string[]): Promise<BuilderExemplar[]> {
    const query = this.createQueryBuilder('exemplar')
      .orderBy('exemplar.createdAt', 'DESC')
      .limit(limit);
    if (repos?.length) {
      query.where('exemplar.repos ?| ARRAY[:...repos]', { repos });
    }
    return query.getMany();
  }

  /** The frozen selection for a session, in a stable order. */
  async findByIds(ids: string[]): Promise<BuilderExemplar[]> {
    if (!ids.length) return [];
    const rows = await this.find({ where: { id: In(ids) } });
    // Restore the ranked order the ids were stored in — the DB returns them
    // in whatever order it likes, and the first exemplar is the most relevant.
    const byId = new Map(rows.map((row) => [row.id, row]));
    return ids.map((id) => byId.get(id)).filter(Boolean) as BuilderExemplar[];
  }

  /** Exemplars whose outcome may still change. */
  listUnsettled(): Promise<BuilderExemplar[]> {
    return this.find({
      where: [
        { outcome: BuilderExemplarOutcome.OPEN },
        { outcome: BuilderExemplarOutcome.PARTIALLY_MERGED },
      ],
      order: { createdAt: 'ASC' },
    });
  }
}

@Injectable()
export class BuilderRepoCatalogRepository extends Repository<BuilderRepoCatalog> {
  constructor(dataSource: DataSource) {
    super(BuilderRepoCatalog, dataSource.createEntityManager());
  }

  findByRepo(repo: string): Promise<BuilderRepoCatalog | null> {
    return this.findOne({ where: { repo } });
  }

  listAll(): Promise<BuilderRepoCatalog[]> {
    return this.find({ order: { repo: 'ASC' } });
  }
}

@Injectable()
export class BuilderEvidenceRepository extends Repository<BuilderEvidence> {
  constructor(dataSource: DataSource) {
    super(BuilderEvidence, dataSource.createEntityManager());
  }

  listBySession(sessionId: string): Promise<BuilderEvidence[]> {
    return this.find({ where: { sessionId }, order: { createdAt: 'ASC' } });
  }
}
