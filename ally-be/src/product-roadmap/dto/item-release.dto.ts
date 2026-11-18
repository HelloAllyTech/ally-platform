import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsString,
  MaxLength,
} from 'class-validator';

import {
  ItemLinkSource,
  ItemLinkState,
  ItemReleaseState,
} from '../enum/item-release.enum';

/** Pull requests one request may link. ItemReleaseService reads the same limit from here. */
export const MAX_LINKED_PRS_PER_REQUEST = 20;

/** "Built elsewhere": the pull requests that delivered an item built outside Builder. */
export class LinkPullRequestsDto {
  @ApiProperty({
    type: [String],
    description:
      'GitHub pull request links, or bare numbers (#123 or 123) for the monorepo. Up to 20.',
    example: [
      'https://github.com/HelloAllyTech/ally-platform/pull/123',
      '#124',
    ],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_LINKED_PRS_PER_REQUEST)
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  prs!: string[];
}

export class ItemReleaseRowDto {
  @ApiProperty({ description: 'be | ai | learn | frontend | mobile | none' })
  service!: string;
  @ApiProperty({
    nullable: true,
    description: 'Frontend only: admin | helpline | both',
  })
  apps!: string | null;
  @ApiProperty({ enum: ItemReleaseState }) state!: ItemReleaseState;
  @ApiProperty({ nullable: true }) tag!: string | null;
  @ApiProperty({ nullable: true }) releasedAt!: Date | null;
}

export class LinkedPrDto {
  @ApiProperty({ description: 'owner/name' }) repo!: string;
  @ApiProperty() prNumber!: number;
  @ApiProperty({ nullable: true }) prUrl!: string | null;
  @ApiProperty({ enum: ItemLinkSource }) source!: ItemLinkSource;
  @ApiProperty({ enum: ItemLinkState }) state!: ItemLinkState;
  @ApiProperty({ nullable: true }) title!: string | null;
  @ApiProperty({ nullable: true }) mergedAt!: Date | null;
  @ApiProperty({ type: [ItemReleaseRowDto] }) releases!: ItemReleaseRowDto[];
}

export class LinkedPrsResponseDto {
  @ApiProperty({ example: 'OPP-0388' }) code!: string;
  @ApiProperty({ type: [LinkedPrDto] }) linkedPrs!: LinkedPrDto[];
}
