import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from 'src/auth/decorators/auth.metadata';
import { GuideViewService } from '../runtime/guide-view.service';

/**
 * Signed-out endpoints. `availability` is what the learner app's
 * `/course/:id` gate asks before redirecting to `/journey/:id` (plan §5.14):
 * any "no" means the classic landing page. Whether the course itself is
 * public is answered by the existing public outline endpoint.
 */
@ApiTags('Ally guide')
@Controller('v1/guide/public')
export class GuidePublicController {
  constructor(private readonly view: GuideViewService) {}

  @Get('availability/:trackId')
  @Public()
  @ApiOperation({
    summary:
      'Whether the guided experience is on for this course, its languages, and why not',
  })
  availability(@Param('trackId', ParseUUIDPipe) trackId: string) {
    return this.view.availability(trackId);
  }
}
