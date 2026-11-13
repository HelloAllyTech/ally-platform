import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import {
  CreateSessionBookmarkDto,
  SessionBookmarkDto,
} from '../dto/create-session-bookmark.dto';
import { SessionBookmarksService } from '../service/session-bookmarks.service';

@Controller({ path: 'session-bookmarks', version: '1' })
@ApiBearerAuth()
@ApiSecurity('access-token')
@ApiTags('Session Bookmarks')
export class SessionBookmarksController {
  constructor(private readonly service: SessionBookmarksService) {}

  @ApiOperation({ description: 'Save a roleplay session to come back to' })
  @AuthPermissions([PERMISSIONS.VIEW_SIMULATION_REVIEW])
  @Post()
  create(@Body() dto: CreateSessionBookmarkDto): Promise<SessionBookmarkDto> {
    return this.service.create(dto);
  }

  @ApiOperation({ description: 'The sessions I have saved, newest first' })
  @AuthPermissions([PERMISSIONS.VIEW_SIMULATION_REVIEW])
  @Get()
  list(): Promise<SessionBookmarkDto[]> {
    return this.service.list();
  }

  @ApiOperation({ description: 'Remove a saved session' })
  @AuthPermissions([PERMISSIONS.VIEW_SIMULATION_REVIEW])
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.service.remove(id);
  }
}
