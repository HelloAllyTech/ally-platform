import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CourseCopilotSession } from '../entity/course-copilot-session.entity';
import {
  AnalysisSignal,
  analysisSignals,
} from '../util/course-pilot-analysis.util';
import {
  CourseCopilotLearnerResultsService,
  LEARNER_RESULTS_MIN_LEARNERS,
} from './course-copilot-learner-results.service';
import {
  CourseAnalystSpecialist,
  CourseAnalystSuggestion,
} from './specialists/course-analyst.specialist';

/** What an analysis found, kept in metadata.coursePilot.analysis for the Improve stage. */
export interface CoursePilotAnalysisRecord {
  at: string;
  learners: number;
  finished: number;
  /** False below the minimum number of learners: nothing was measured. */
  enough: boolean;
  signals: AnalysisSignal[];
  summary: string;
  suggestions: CourseAnalystSuggestion[];
  /** The session's last message seq when it ran: edits after it count as improvements. */
  afterSeq: number;
  /** Set when the Analyst model failed; the signals still stand. */
  error?: string;
}

const things = (n: number) => `${n} thing${n === 1 ? '' : 's'} worth a look.`;

/**
 * Course Pilot's Improve stage. Code reads the learner results (the session's organisation only;
 * get_learner_results' numbers) and raises signals; the Analyst model explains them and proposes
 * edits, and is called only when there is a signal to explain.
 */
@Injectable()
export class CoursePilotAnalystService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly learnerResults: CourseCopilotLearnerResultsService,
    @Optional() private readonly analyst?: CourseAnalystSpecialist,
  ) {}

  async analyse(
    session: CourseCopilotSession,
    outline: string,
  ): Promise<CoursePilotAnalysisRecord> {
    const [results, seqRows] = await Promise.all([
      this.learnerResults.forCourse(session.trackId!, session.tenantId),
      this.dataSource.query(
        `SELECT coalesce(max(seq), 0)::int AS seq FROM course_copilot_messages WHERE "sessionId" = $1`,
        [session.id],
      ),
    ]);
    const base = {
      at: new Date().toISOString(),
      learners: results.enrolled,
      finished: results.completed,
      afterSeq: Number(seqRows?.[0]?.seq ?? 0),
    };
    if (results.enrolled < LEARNER_RESULTS_MIN_LEARNERS) {
      return {
        ...base,
        enough: false,
        signals: [],
        summary: `Not enough learners yet: ${results.enrolled} enrolled, ${LEARNER_RESULTS_MIN_LEARNERS} needed before the numbers mean anything.`,
        suggestions: [],
      };
    }
    const signals = analysisSignals(results);
    if (!signals.length || !this.analyst) {
      return {
        ...base,
        enough: true,
        signals,
        summary: signals.length
          ? things(signals.length)
          : `${results.completed} of ${results.enrolled} learners finished; no item stands out.`,
        suggestions: [],
      };
    }
    try {
      const result = await this.analyst.analyse({
        outline,
        results: this.learnerResults.render(results),
        itemIds: results.items.map((item) => item.itemId),
        signals,
        usageMetadata: { courseCopilotSessionId: session.id },
      });
      return {
        ...base,
        enough: true,
        signals,
        summary: result.summary || things(signals.length),
        suggestions: result.suggestions,
      };
    } catch (error) {
      return {
        ...base,
        enough: true,
        signals,
        summary: things(signals.length),
        suggestions: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
