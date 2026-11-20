import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, Matches } from 'class-validator';

import { RELEASE_POLICY_SERVICES } from '../constants/release-policy.constants';

export class ReleasePlanQueryDto {
  @ApiProperty({ enum: RELEASE_POLICY_SERVICES, example: 'be' })
  @IsString()
  service!: string;
}

/** A Release click: the service, and the newest service commit the person was shown. */
export class ReleaseServiceDto {
  @ApiProperty({ enum: RELEASE_POLICY_SERVICES, example: 'be' })
  @IsIn(RELEASE_POLICY_SERVICES as unknown as string[])
  service!: string;

  @ApiProperty({
    description:
      '`serviceHeadSha` from the plan the person reviewed. The release is refused (409) if more of the service landed since, so what the dialog listed is what ships.',
  })
  @IsString()
  @Matches(/^[0-9a-f]{7,64}$/i)
  serviceHeadSha!: string;
}
