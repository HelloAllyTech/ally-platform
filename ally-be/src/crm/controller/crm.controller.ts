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
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';

import { RequireFeatureToggle } from 'src/auth/decorators/feature-toggle.decorator';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';

import {
  ContactDetailDto,
  ContactListDto,
  ContactLogDto,
  ContactManagersDto,
  CreateContactDto,
  CreateContactLogDto,
  ListContactsDto,
  MatchContactsDto,
  UpdateContactDto,
  UpdateContactLogDto,
} from '../dto/crm.dto';
import { CrmService } from '../service/crm.service';

/**
 * The admin console's Contacts tab. Every route needs the `crm_contacts`
 * toggle (default off, granted per admin in Admin User Management) on top of
 * the platform-admin permission; everyone who holds it reads and writes the
 * same shared list. Fixed paths come before `:id` so none is read as an id.
 */
@ApiTags('CRM contacts')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('v1/crm')
export class CrmController {
  constructor(private readonly crmService: CrmService) {}

  @Get('managers')
  @RequireFeatureToggle(FeatureToggleKey.CRM_CONTACTS)
  @ApiOperation({
    summary: 'People who can be a contact’s relationship manager',
  })
  @ApiResponse({ status: 200, type: ContactManagersDto })
  managers(): Promise<ContactManagersDto> {
    return this.crmService.managers();
  }

  @Get('contacts/match')
  @RequireFeatureToggle(FeatureToggleKey.CRM_CONTACTS)
  @ApiOperation({
    summary: 'Existing contacts with a similar name, to avoid duplicates',
  })
  @ApiResponse({ status: 200, type: ContactListDto })
  match(@Query() query: MatchContactsDto): Promise<ContactListDto> {
    return this.crmService.matchByName(query.name);
  }

  @Get('contacts')
  @RequireFeatureToggle(FeatureToggleKey.CRM_CONTACTS)
  @ApiOperation({ summary: 'List or search contacts, A to Z' })
  @ApiResponse({ status: 200, type: ContactListDto })
  list(@Query() query: ListContactsDto): Promise<ContactListDto> {
    return this.crmService.list(query.search, query.limit);
  }

  @Post('contacts')
  @RequireFeatureToggle(FeatureToggleKey.CRM_CONTACTS)
  @ApiOperation({ summary: 'Add a contact' })
  @ApiResponse({ status: 201, type: ContactDetailDto })
  create(@Body() body: CreateContactDto): Promise<ContactDetailDto> {
    return this.crmService.create(body);
  }

  @Get('contacts/:id')
  @RequireFeatureToggle(FeatureToggleKey.CRM_CONTACTS)
  @ApiParam({ name: 'id', description: 'Contact UUID' })
  @ApiOperation({ summary: 'One contact with its conversation log' })
  @ApiResponse({ status: 200, type: ContactDetailDto })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<ContactDetailDto> {
    return this.crmService.get(id);
  }

  @Patch('contacts/:id')
  @RequireFeatureToggle(FeatureToggleKey.CRM_CONTACTS)
  @ApiParam({ name: 'id', description: 'Contact UUID' })
  @ApiOperation({
    summary: 'Edit a contact or change its relationship manager',
  })
  @ApiResponse({ status: 200, type: ContactDetailDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateContactDto,
  ): Promise<ContactDetailDto> {
    return this.crmService.update(id, body);
  }

  @Delete('contacts/:id')
  @HttpCode(204)
  @RequireFeatureToggle(FeatureToggleKey.CRM_CONTACTS)
  @ApiParam({ name: 'id', description: 'Contact UUID' })
  @ApiOperation({ summary: 'Delete a contact and its log' })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.crmService.remove(id);
  }

  @Post('contacts/:id/logs')
  @RequireFeatureToggle(FeatureToggleKey.CRM_CONTACTS)
  @ApiParam({ name: 'id', description: 'Contact UUID' })
  @ApiOperation({ summary: 'Log a key event or conversation' })
  @ApiResponse({ status: 201, type: [ContactLogDto] })
  addLog(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CreateContactLogDto,
  ): Promise<ContactLogDto[]> {
    return this.crmService.addLog(id, body);
  }

  @Patch('contacts/:id/logs/:logId')
  @RequireFeatureToggle(FeatureToggleKey.CRM_CONTACTS)
  @ApiParam({ name: 'id', description: 'Contact UUID' })
  @ApiParam({ name: 'logId', description: 'Log entry UUID' })
  @ApiOperation({ summary: 'Edit a log entry' })
  @ApiResponse({ status: 200, type: [ContactLogDto] })
  updateLog(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('logId', ParseUUIDPipe) logId: string,
    @Body() body: UpdateContactLogDto,
  ): Promise<ContactLogDto[]> {
    return this.crmService.updateLog(id, logId, body);
  }

  @Delete('contacts/:id/logs/:logId')
  @RequireFeatureToggle(FeatureToggleKey.CRM_CONTACTS)
  @ApiParam({ name: 'id', description: 'Contact UUID' })
  @ApiParam({ name: 'logId', description: 'Log entry UUID' })
  @ApiOperation({ summary: 'Delete a log entry' })
  @ApiResponse({ status: 200, type: [ContactLogDto] })
  removeLog(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('logId', ParseUUIDPipe) logId: string,
  ): Promise<ContactLogDto[]> {
    return this.crmService.removeLog(id, logId);
  }
}
