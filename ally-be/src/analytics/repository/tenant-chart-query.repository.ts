import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  ChartScope,
  CompileContext,
  DistributionSessionSpec,
  RankedSessionSpec,
  compileDistributionBins,
  compileMedian,
  compileRanked,
} from '../util/tenant-chart-query.util';

export interface RankedRow {
  key: string;
  label: string;
  value: number;
  sessions: number;
}

export interface DistributionResult {
  /** Ten bins: 0-9, 10-19, ... 90-100. */
  bins: number[];
  sessions: number;
  median: number | null;
}

export interface QueryWindow {
  tenantId: string;
  tenantCode: string;
  start: Date;
  endExclusive: Date;
  scope: ChartScope;
}

/**
 * Runs compiled chart specs. Holds no SQL of its own: the compiler in
 * `tenant-chart-query.util.ts` builds every statement. Aggregates only, so a row
 * carries a title and numbers, never a learner's name, email or free text.
 */
@Injectable()
export class TenantChartQueryRepository {
  constructor(private readonly dataSource: DataSource) {}

  async ranked(spec: RankedSessionSpec, w: QueryWindow): Promise<RankedRow[]> {
    const q = compileRanked(spec, w as CompileContext);
    const rows: Array<{
      key: string;
      label: string;
      value: string;
      sessions: string;
    }> = await this.dataSource.query(q.sql, q.params);
    return rows.map((r) => ({
      key: r.key,
      label: r.label,
      value:
        spec.measure === 'averageScore'
          ? Math.round(Number(r.value))
          : Number(r.value),
      sessions: Number(r.sessions),
    }));
  }

  async distribution(
    _spec: DistributionSessionSpec,
    w: QueryWindow,
  ): Promise<DistributionResult> {
    const ctx = w as CompileContext;
    const binsQuery = compileDistributionBins(ctx);
    const medianQuery = compileMedian(ctx);
    const [binRows, medianRows]: [
      Array<{ bin: number; n: string }>,
      Array<{ median: string | null }>,
    ] = await Promise.all([
      this.dataSource.query(binsQuery.sql, binsQuery.params),
      this.dataSource.query(medianQuery.sql, medianQuery.params),
    ]);
    const bins = Array.from({ length: 10 }, () => 0);
    binRows.forEach((r) => {
      bins[Number(r.bin)] = Number(r.n);
    });
    const median = medianRows[0]?.median;
    return {
      bins,
      sessions: bins.reduce((a, b) => a + b, 0),
      median: median == null ? null : Math.round(Number(median)),
    };
  }
}
