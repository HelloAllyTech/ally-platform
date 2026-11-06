import { ApiProperty } from '@nestjs/swagger';

/** One admin's activity in one month. */
export class RoadmapVotingUserMonthDto {
  @ApiProperty({ description: 'Ally users.id' })
  userId!: number;

  @ApiProperty({
    description:
      'Votes cast in this month that still stand — a vote taken back is gone, ' +
      'a vote on something that has since shipped still counts. 0 for an admin ' +
      'who had access and did not vote.',
  })
  votes!: number;

  @ApiProperty({
    description:
      'Of `votes`, how many were cast on opportunities authored by someone ' +
      'else (a colleague). `votes` minus the votes on their own ideas.',
  })
  votesOnOthers!: number;

  @ApiProperty({
    description:
      'Votes issued to them for this month (monthly + daily grants, never ' +
      'refunds). Null before the grant ledger existed.',
    nullable: true,
    type: Number,
  })
  granted!: number | null;
}

/** One calendar month of roadmap voting. */
export class RoadmapVotingMonthDto {
  @ApiProperty({ description: 'First day of the month (yyyy-mm-01)' })
  month!: string;

  @ApiProperty({
    description:
      'True for the current calendar month. Kept, not dropped: "who has voted ' +
      'so far this month" is the reading that lets someone nudge the rest ' +
      'before it closes.',
  })
  partial!: boolean;

  @ApiProperty({ description: 'Total votes cast in the month, every admin' })
  votes!: number;

  @ApiProperty({ description: 'Admins who cast at least one vote' })
  voters!: number;

  @ApiProperty({
    description:
      'Admins who could vote this month: everyone issued a grant for it, plus ' +
      'anyone who voted, plus (current month only) every holder of the vote ' +
      'permission today. Null before the grant ledger existed, when who had ' +
      'access was never recorded — the client says so rather than guessing.',
    nullable: true,
    type: Number,
  })
  eligible!: number | null;

  @ApiProperty({
    description:
      'Votes issued for the month across the team. Null before the grant ledger.',
    nullable: true,
    type: Number,
  })
  granted!: number | null;

  @ApiProperty({
    description:
      'Every eligible admin, voters and non-voters alike, so the client can ' +
      'show who has not voted as well as who has. Before the ledger, voters only.',
    type: [RoadmapVotingUserMonthDto],
  })
  users!: RoadmapVotingUserMonthDto[];
}

/** One admin across the whole axis. */
export class RoadmapVoterDto {
  @ApiProperty({ description: 'Ally users.id' })
  userId!: number;

  @ApiProperty({
    description:
      'Display name — the account name, suffixed with the id when two admins ' +
      'share one, `Admin #<id>` when it is blank.',
    example: 'Sandeep Malhotra',
  })
  name!: string;

  @ApiProperty({ description: 'Votes cast across every month on the axis' })
  votes!: number;

  @ApiProperty({ description: 'Months in which they cast at least one vote' })
  monthsVoted!: number;

  @ApiProperty({
    description: 'Most recent month they voted in (yyyy-mm-01), or null',
    nullable: true,
    type: String,
  })
  lastVotedMonth!: string | null;

  @ApiProperty({
    description: 'Holds `vote:admin:product-roadmap` today',
  })
  hasAccessNow!: boolean;
}

/**
 * Roadmap voting participation across the team, by month and by admin.
 * All-time and month-grained by construction.
 */
export class RoadmapVotingResponseDto {
  @ApiProperty({
    description:
      'Oldest first, from the first month with a vote or a grant through the ' +
      'current month, with no gaps. Empty when nobody has ever voted or been ' +
      'issued a vote.',
    type: [RoadmapVotingMonthDto],
  })
  months!: RoadmapVotingMonthDto[];

  @ApiProperty({
    description:
      'Every admin who appears anywhere in `months` or has access today, ' +
      'highest all-time votes first, then by name — the legend and stack order.',
    type: [RoadmapVoterDto],
  })
  users!: RoadmapVoterDto[];

  @ApiProperty({
    description:
      'First month (yyyy-mm-01) for which access was recorded in the grant ' +
      'ledger. Months before it have `eligible: null`. Null if no grant exists.',
    nullable: true,
    type: String,
  })
  accessRecordedFrom!: string | null;

  @ApiProperty({ description: 'When this response was computed (ISO 8601)' })
  computedAt!: string;
}
