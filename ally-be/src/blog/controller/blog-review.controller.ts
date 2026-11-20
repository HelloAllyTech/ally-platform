import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Request } from 'express';

import { Public } from 'src/auth/decorators/auth.metadata';
import { RequireFeatureToggle } from 'src/auth/decorators/feature-toggle.decorator';
import { CurrentUser } from 'src/auth/decorators/user.decorator';
import { TokenUser } from 'src/auth/type/auth.types';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';

import { BlogSuggestionStatus } from '../entity/blog-review.entity';
import { BlogReviewService } from '../service/blog-review.service';

class CreateReviewLinkDto {
  @ApiPropertyOptional({
    description: 'Days the link works (1 to 60)',
    default: 14,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  days?: number;
}

class UpdateSuggestionStatusDto {
  @ApiProperty({ enum: BlogSuggestionStatus })
  @IsEnum(BlogSuggestionStatus)
  status!: BlogSuggestionStatus;
}

/**
 * Sharing a draft post for review. The public routes work from the link's token alone (no sign-in);
 * the admin routes manage the link and read the suggestions.
 */
@ApiTags('Blogs — review')
@Controller('v1/blog-review')
export class BlogReviewController {
  constructor(private readonly review: BlogReviewService) {}

  // ---- Admin (declared first: "posts" must not be read as a token) ---------

  @Get('posts/:id')
  @ApiBearerAuth()
  @ApiSecurity('access-token')
  @RequireFeatureToggle(FeatureToggleKey.BLOG, {
    permissions: [PERMISSIONS.VIEW_BLOGS],
  })
  @ApiOperation({ summary: "A draft's review link and the suggestions on it" })
  getForPost(@Param('id', ParseUUIDPipe) id: string) {
    return this.review.getForPost(id);
  }

  @Post('posts/:id/link')
  @ApiBearerAuth()
  @ApiSecurity('access-token')
  @RequireFeatureToggle(FeatureToggleKey.BLOG, {
    permissions: [PERMISSIONS.EDIT_BLOG],
  })
  @ApiOperation({
    summary:
      'Create a review link for a draft (returns the active one when there is one)',
  })
  createLink(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CreateReviewLinkDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.review.createLink(id, body?.days, user.id);
  }

  @Delete('posts/:id/link')
  @ApiBearerAuth()
  @ApiSecurity('access-token')
  @RequireFeatureToggle(FeatureToggleKey.BLOG, {
    permissions: [PERMISSIONS.EDIT_BLOG],
  })
  @ApiOperation({ summary: 'Turn the review link off' })
  revokeLink(@Param('id', ParseUUIDPipe) id: string) {
    return this.review.revokeLink(id);
  }

  @Patch('posts/:id/suggestions/:suggestionId')
  @ApiBearerAuth()
  @ApiSecurity('access-token')
  @RequireFeatureToggle(FeatureToggleKey.BLOG, {
    permissions: [PERMISSIONS.EDIT_BLOG],
  })
  @ApiOperation({ summary: 'Mark a suggestion done, or reopen it' })
  setSuggestionStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('suggestionId', ParseUUIDPipe) suggestionId: string,
    @Body() body: UpdateSuggestionStatusDto,
  ) {
    return this.review.setSuggestionStatus(id, suggestionId, body.status);
  }

  // ---- Public (by link) -----------------------------------------------------

  @Get(':token')
  @Public()
  @ApiOperation({
    summary: 'Read a draft through its review link (public, no sign-in)',
  })
  view(@Param('token') token: string) {
    return this.review.viewByToken(token);
  }

  @Post(':token/suggestions')
  @Public()
  @ApiOperation({
    summary: 'Send a suggestion on a draft (public, no sign-in, rate limited)',
  })
  suggest(
    @Param('token') token: string,
    @Body() body: Record<string, unknown>,
    @Req() req: Request,
  ) {
    return this.review.addSuggestion(token, body ?? {}, req.ip);
  }
}
