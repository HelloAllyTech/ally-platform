import {
  BadRequestException,
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
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { Response } from 'express';
import { CallerScopedRoute } from '../../auth/decorators/caller-scoped-route.decorator';
import { RequireFeatureToggle } from '../../auth/decorators/feature-toggle.decorator';
import { FeatureToggleKey } from '../../authorization/constants/admin-feature-toggle.constants';
import { PERMISSIONS } from '../../authorization/constants/permissions.constants';
import { ExecutionManager } from '../../common/execution/execution-manager';
import { ChatbotMemberRole } from '../enum/chatbot.enum';
import { ChatbotAccessService } from '../service/chatbot-access.service';
import {
  AddListRuleDto,
  CreateListDto,
  ImportListDto,
  ListFieldDto,
  ListRecordDto,
  QueryListRecordsDto,
  UpdateListDto,
  UpdateListFieldDto,
  UpdateListRecordDto,
} from './dto/list.dto';
import { ListCsvService } from './list-csv.service';
import { ListDefinitionsService } from './list-definitions.service';
import { LIST_LIMITS } from './list-limits';
import { ListRecordsService } from './list-records.service';
import type { ListActor, ListFilter, ListQuery } from './list-types';

const VIEW = { permissions: [PERMISSIONS.VIEW_WHATSAPP_BOT] };
const EDIT = { permissions: [PERMISSIONS.EDIT_WHATSAPP_BOT] };
const EDITOR = ChatbotMemberRole.EDITOR;

const user = (): ListActor => ({
  kind: 'user',
  userId: Number(ExecutionManager.getUserId() ?? 0),
});

/** `GET …/records`'s simple filters: `eq.<key>`, `contains.<key>`, `from.<key>`, `to.<key>`. */
function filtersFrom(query: Record<string, unknown>): ListFilter[] {
  const filters: ListFilter[] = [];
  for (const [name, value] of Object.entries(query)) {
    const m = /^(eq|contains|from|to)\.([a-z0-9_]{1,40})$/.exec(name);
    if (m && typeof value === 'string') {
      filters.push({ op: m[1] as ListFilter['op'], field: m[2], value });
    }
  }
  return filters;
}

/**
 * A bot's lists (Agents v2, chunk 5a): definitions, fields, rules, records and CSV. Access is the
 * bot's own: members read, editors write; another bot's ids answer 404. A refusal is
 * `{ code, field?, message, conflict? }` with 400, 404 or 409.
 */
@ApiTags('Chatbot lists')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('v1/chatbots')
@CallerScopedRoute()
export class ListController {
  constructor(
    private readonly access: ChatbotAccessService,
    private readonly definitions: ListDefinitionsService,
    private readonly records: ListRecordsService,
    private readonly csv: ListCsvService,
  ) {}

  // ---- lists ----------------------------------------------------------------------------------

  @Get(':id/lists')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, VIEW)
  @ApiOperation({ summary: "The bot's lists, with their fields and rules" })
  async listLists(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('include_deleted') includeDeleted?: string,
  ) {
    await this.access.assert(id);
    return this.definitions.listLists(id, {
      includeDeleted: includeDeleted === 'true',
    });
  }

  @Post(':id/lists')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({ summary: 'Create a list, optionally with its fields' })
  async createList(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateListDto,
  ) {
    await this.access.assert(id, EDITOR);
    return this.definitions.createList(id, dto);
  }

  @Get(':id/lists/:key')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, VIEW)
  @ApiOperation({
    summary: 'One list, with its fields (archived ones too) and rules',
  })
  async getList(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('key') key: string,
  ) {
    await this.access.assert(id);
    return this.definitions.getList(id, key);
  }

  @Patch(':id/lists/:key')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({ summary: "Change a list's name, settings or agent switches" })
  async updateList(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('key') key: string,
    @Body() dto: UpdateListDto,
  ) {
    await this.access.assert(id, EDITOR);
    return this.definitions.updateList(id, key, dto);
  }

  @Delete(':id/lists/:key')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({ summary: 'Delete a list (restorable for 30 days)' })
  async deleteList(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('key') key: string,
  ) {
    await this.access.assert(id, EDITOR);
    return this.definitions.deleteList(id, key);
  }

  @Post(':id/lists/:listId/restore')
  @HttpCode(200)
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary: 'Restore a deleted list, by its id, within 30 days',
  })
  async restoreList(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('listId', ParseUUIDPipe) listId: string,
  ) {
    await this.access.assert(id, EDITOR);
    return this.definitions.restoreList(id, listId);
  }

  // ---- fields ---------------------------------------------------------------------------------

  @Post(':id/lists/:key/fields')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({ summary: 'Add a field' })
  async addField(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('key') key: string,
    @Body() dto: ListFieldDto,
  ) {
    await this.access.assert(id, EDITOR);
    return this.definitions.addField(id, key, dto);
  }

  @Patch(':id/lists/:key/fields/:field')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary: 'Change a field',
    description:
      'A type change is refused while any entry has a value for the field.',
  })
  async updateField(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('key') key: string,
    @Param('field') field: string,
    @Body() dto: UpdateListFieldDto,
  ) {
    await this.access.assert(id, EDITOR);
    return this.definitions.updateField(id, key, field, dto);
  }

  @Delete(':id/lists/:key/fields/:field')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({ summary: 'Archive a field: hidden, and its values kept' })
  async archiveField(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('key') key: string,
    @Param('field') field: string,
  ) {
    await this.access.assert(id, EDITOR);
    return this.definitions.archiveField(id, key, field);
  }

  // ---- rules ----------------------------------------------------------------------------------

  @Post(':id/lists/:key/rules')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary: 'Add a rule',
    description:
      'Refused, with the records that break it, if existing entries already do.',
  })
  async addRule(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('key') key: string,
    @Body() dto: AddListRuleDto,
  ) {
    await this.access.assert(id, EDITOR);
    return this.definitions.addRule(id, key, dto);
  }

  @Delete(':id/lists/:key/rules/:ruleId')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({ summary: 'Remove a rule' })
  async removeRule(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('key') key: string,
    @Param('ruleId', ParseUUIDPipe) ruleId: string,
  ) {
    await this.access.assert(id, EDITOR);
    return this.definitions.removeRule(id, key, ruleId);
  }

  // ---- records --------------------------------------------------------------------------------

  @Get(':id/lists/:key/records')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, VIEW)
  @ApiOperation({
    summary: 'Entries, with simple filters',
    description:
      'Query: sort (key or -key), limit, cursor, include_deleted, and eq.<key>, contains.<key>, from.<key>, to.<key>.',
  })
  async listRecords(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('key') key: string,
    @Query() query: Record<string, unknown>,
  ) {
    await this.access.assert(id);
    const q: ListQuery = {
      filters: filtersFrom(query),
      sort: typeof query.sort === 'string' ? query.sort : undefined,
      cursor: typeof query.cursor === 'string' ? query.cursor : undefined,
      limit:
        query.limit !== undefined
          ? Number(query.limit) || undefined
          : undefined,
      aggregate:
        typeof query.aggregate === 'string' ? query.aggregate : undefined,
      includeDeleted: query.include_deleted === 'true',
    };
    return this.records.query(id, key, user(), q);
  }

  @Post(':id/lists/:key/records/query')
  @HttpCode(200)
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, VIEW)
  @ApiOperation({
    summary: 'Entries: filters, sort, cursor, limit, and a count or sum',
  })
  async queryRecords(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('key') key: string,
    @Body() dto: QueryListRecordsDto,
  ) {
    await this.access.assert(id);
    return this.records.query(id, key, user(), {
      filters: dto.filters,
      sort: dto.sort,
      cursor: dto.cursor,
      limit: dto.limit,
      aggregate: dto.aggregate,
      includeDeleted: dto.include_deleted,
    });
  }

  @Get(':id/lists/:key/records/:recordId')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, VIEW)
  @ApiOperation({ summary: 'One entry' })
  async getRecord(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('key') key: string,
    @Param('recordId', ParseUUIDPipe) recordId: string,
  ) {
    await this.access.assert(id);
    return this.records.get(id, key, user(), recordId);
  }

  @Post(':id/lists/:key/records')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({ summary: 'Add an entry; every rule is checked' })
  async createRecord(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('key') key: string,
    @Body() dto: ListRecordDto,
  ) {
    await this.access.assert(id, EDITOR);
    return this.records.create(id, key, user(), dto.data);
  }

  @Patch(':id/lists/:key/records/:recordId')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({ summary: 'Change an entry; send the version you read' })
  async updateRecord(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('key') key: string,
    @Param('recordId', ParseUUIDPipe) recordId: string,
    @Body() dto: UpdateListRecordDto,
  ) {
    await this.access.assert(id, EDITOR);
    return this.records.update(
      id,
      key,
      user(),
      recordId,
      dto.data,
      dto.version,
    );
  }

  @Delete(':id/lists/:key/records/:recordId')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({ summary: 'Delete an entry (restorable)' })
  async deleteRecord(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('key') key: string,
    @Param('recordId', ParseUUIDPipe) recordId: string,
  ) {
    await this.access.assert(id, EDITOR);
    return this.records.delete(id, key, user(), recordId);
  }

  @Post(':id/lists/:key/records/:recordId/restore')
  @HttpCode(200)
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary: 'Restore a deleted entry, if every rule still holds',
  })
  async restoreRecord(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('key') key: string,
    @Param('recordId', ParseUUIDPipe) recordId: string,
  ) {
    await this.access.assert(id, EDITOR);
    return this.records.restore(id, key, user(), recordId);
  }

  // ---- CSV ------------------------------------------------------------------------------------

  /** Editors only: it's every person's entries in one file. */
  @Get(':id/lists/:key/export.csv')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({ summary: 'The list as CSV (editors)' })
  async exportCsv(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('key') key: string,
    @Res() res: Response,
  ) {
    await this.access.assert(id, EDITOR);
    const csv = await this.csv.export(id, key);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${key}.csv"`);
    res.send(csv);
  }

  @Post(':id/lists/:key/import')
  @HttpCode(200)
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Import CSV: a dry run unless commit=true',
    description:
      'A row with an id updates that entry; without one, it adds an entry. Every rule applies. Errors are per row.',
  })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: LIST_LIMITS.csvBytes + 1, files: 1 },
    }),
  )
  async importCsv(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('key') key: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: ImportListDto,
  ) {
    await this.access.assert(id, EDITOR);
    if (!file) throw new BadRequestException('Attach a CSV file as "file".');
    const actor = user();
    return this.csv.import(
      id,
      key,
      { kind: 'import', userId: actor.kind === 'user' ? actor.userId : null },
      file.buffer,
      { commit: dto.commit === 'true' },
    );
  }
}
