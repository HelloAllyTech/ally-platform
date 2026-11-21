import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { CallerScopedRoute } from '../../auth/decorators/caller-scoped-route.decorator';
import { CurrentUser } from '../../auth/decorators/user.decorator';
import type { TokenUser } from '../../auth/type/auth.types';
import {
  CreateDirectoryCollectionDto,
  PatchDirectoryCollectionDto,
  PatchDirectoryEntryDto,
  SetDirectoryDomainDto,
  UpsertDirectoryEntryDto,
} from '../dto/directory.dto';
import { DirectoryService, EntryScope } from '../service/directory.service';

/**
 * The directory's signed-in API. Open to any signed-in user: there is no feature switch or
 * permission, because ownership is the rule. Every handler is keyed on the caller's id, so the
 * whole controller is @CallerScopedRoute.
 */
@ApiTags('Directory')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('v1/directory')
@CallerScopedRoute()
export class DirectoryController {
  constructor(private readonly service: DirectoryService) {}

  @Get('entries')
  @ApiOperation({
    summary:
      'Public entries and your own (scope: all | public | mine), with search and category',
  })
  listEntries(
    @CurrentUser() user: TokenUser,
    @Query('scope') scope?: EntryScope,
    @Query('search') search?: string,
    @Query('category') category?: string,
  ) {
    const safeScope: EntryScope =
      scope === 'public' || scope === 'mine' ? scope : 'all';
    return this.service.listEntries(user.id, {
      scope: safeScope,
      search,
      category,
    });
  }

  @Post('entries')
  @ApiOperation({ summary: 'Add an entry (private unless you make it public)' })
  createEntry(
    @CurrentUser() user: TokenUser,
    @Body() dto: UpsertDirectoryEntryDto,
  ) {
    return this.service.createEntry(user.id, dto);
  }

  @Get('entries/:id')
  @ApiOperation({ summary: 'One entry: public, or yours' })
  getEntry(
    @CurrentUser() user: TokenUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.getEntry(user.id, id);
  }

  @Get('entries/:id/collections')
  @ApiOperation({ summary: 'Ids of your collections that hold this entry' })
  collectionsHolding(
    @CurrentUser() user: TokenUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.collectionsHolding(user.id, id);
  }

  @Patch('entries/:id')
  @ApiOperation({ summary: 'Edit an entry you added (403 for anyone else)' })
  updateEntry(
    @CurrentUser() user: TokenUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PatchDirectoryEntryDto,
  ) {
    return this.service.updateEntry(user.id, id, dto);
  }

  @Delete('entries/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete an entry you added' })
  async deleteEntry(
    @CurrentUser() user: TokenUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.service.deleteEntry(user.id, id);
  }

  @Get('collections')
  @ApiOperation({ summary: 'Your collections (saved views)' })
  listCollections(@CurrentUser() user: TokenUser) {
    return this.service.listCollections(user.id);
  }

  @Post('collections')
  @ApiOperation({ summary: 'Create a collection; it starts unpublished' })
  createCollection(
    @CurrentUser() user: TokenUser,
    @Body() dto: CreateDirectoryCollectionDto,
  ) {
    return this.service.createCollection(user.id, dto);
  }

  @Get('collections/:id')
  @ApiOperation({ summary: 'One of your collections, with its entries' })
  getCollection(
    @CurrentUser() user: TokenUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.getCollection(user.id, id);
  }

  @Patch('collections/:id')
  @ApiOperation({
    summary:
      'Edit a collection you own: name, page address, publish, page settings',
  })
  updateCollection(
    @CurrentUser() user: TokenUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PatchDirectoryCollectionDto,
  ) {
    return this.service.updateCollection(user.id, id, dto);
  }

  @Delete('collections/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a collection you own (its entries stay)' })
  async deleteCollection(
    @CurrentUser() user: TokenUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.service.deleteCollection(user.id, id);
  }

  @Put('collections/:id/entries/:entryId')
  @ApiOperation({
    summary: 'Save an entry to a collection (a public one, or one of yours)',
  })
  addEntry(
    @CurrentUser() user: TokenUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('entryId', ParseUUIDPipe) entryId: string,
  ) {
    return this.service.addEntry(user.id, id, entryId);
  }

  @Delete('collections/:id/entries/:entryId')
  @ApiOperation({ summary: 'Remove an entry from a collection you own' })
  removeEntry(
    @CurrentUser() user: TokenUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('entryId', ParseUUIDPipe) entryId: string,
  ) {
    return this.service.removeEntry(user.id, id, entryId);
  }

  @Put('collections/:id/domain')
  @ApiOperation({
    summary: 'Set a custom domain; returns the DNS records to add',
  })
  setDomain(
    @CurrentUser() user: TokenUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetDirectoryDomainDto,
  ) {
    return this.service.setDomain(user.id, id, dto.domain);
  }

  @Delete('collections/:id/domain')
  @ApiOperation({ summary: 'Remove the custom domain' })
  clearDomain(
    @CurrentUser() user: TokenUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.clearDomain(user.id, id);
  }

  @Post('collections/:id/domain/verify')
  @HttpCode(200)
  @ApiOperation({ summary: "Check the domain's TXT record now" })
  verifyDomain(
    @CurrentUser() user: TokenUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.verifyDomain(user.id, id);
  }
}
