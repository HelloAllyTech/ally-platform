import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
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
import { CurrentUser } from 'src/auth/decorators/user.decorator';
import { RequireFeatureToggle } from 'src/auth/decorators/feature-toggle.decorator';
import { TokenUser } from 'src/auth/type/auth.types';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import {
  AddModelDto,
  BreakdownQueryDto,
  CostSettingsDto,
  EditModelDto,
  FixedCostDto,
  ModelStatusDto,
  NoteDto,
  PriceDto,
  WhatsAppRateDto,
} from '../dto/billing-admin.dto';
import { WhatsAppRateCategory } from '../enum/billing.enum';
import { BillingAuditService } from '../service/billing-audit.service';
import { BillingCatalogueService } from '../service/billing-catalogue.service';
import { CostReportService, parsePeriod } from '../service/cost-report.service';

/**
 * Ally admin → Models and → Costs (CR1 Part A). Super admins only: every route needs the
 * `manage_costs` toggle, checked on the server by FeatureToggleGuard.
 */
@ApiTags('Billing (Ally admin)')
@ApiBearerAuth()
@ApiSecurity('access-token')
@RequireFeatureToggle(FeatureToggleKey.MANAGE_COSTS)
@Controller('v1/admin/billing')
export class BillingAdminController {
  constructor(
    private readonly catalogue: BillingCatalogueService,
    private readonly reports: CostReportService,
    private readonly audit: BillingAuditService,
  ) {}

  // ── Models ──
  @ApiOperation({ summary: 'Every model with its current price and usage' })
  @Get('models')
  listModels() {
    return this.catalogue.listModels();
  }

  @ApiOperation({
    summary: 'Models usage reported that are not in the list (unpriced)',
  })
  @Get('models/unknown')
  unknownModels() {
    return this.catalogue.unknownModels();
  }

  @Post('models')
  addModel(@Body() dto: AddModelDto, @CurrentUser() user: TokenUser) {
    return this.catalogue.addModel(
      {
        provider: dto.provider,
        model: dto.model,
        label: dto.label,
        type: dto.type,
        notes: dto.notes,
        price: dto,
        note: dto.note,
      },
      user?.id ?? null,
    );
  }

  @Get('models/:id/history')
  history(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalogue.priceHistory(id);
  }

  @ApiOperation({ summary: 'Save a new price version, effective from a date' })
  @Post('models/:id/prices')
  updatePrice(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PriceDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.catalogue.updatePrice(id, dto, user?.id ?? null);
  }

  @Patch('models/:id')
  editModel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EditModelDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.catalogue.editModel(id, dto, user?.id ?? null);
  }

  @ApiOperation({ summary: 'Retire or reactivate a model' })
  @Put('models/:id/status')
  setStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ModelStatusDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.catalogue.setStatus(id, dto.status, dto.note, user?.id ?? null);
  }

  @ApiOperation({
    summary:
      'Delete a model added by mistake (refused once any usage is recorded)',
  })
  @Delete('models/:id')
  deleteModel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: NoteDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.catalogue.deleteModel(id, dto.note, user?.id ?? null);
  }

  // ── WhatsApp rates ──
  @Get('whatsapp-rates')
  whatsAppRates() {
    return this.catalogue.listWhatsAppRates();
  }

  @Post('whatsapp-rates')
  setWhatsAppRate(
    @Body() dto: WhatsAppRateDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.catalogue.setWhatsAppRate(dto, user?.id ?? null);
  }

  @Delete('whatsapp-rates/:country/:category')
  retireWhatsAppRate(
    @Param('country') country: string,
    @Param('category') category: WhatsAppRateCategory,
    @Body() dto: NoteDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.catalogue.retireWhatsAppRate(
      country,
      category,
      dto.note,
      user?.id ?? null,
    );
  }

  // ── Costs ──
  @ApiOperation({
    summary: 'Totals today, this week and this month, with alerts and settings',
  })
  @Get('costs')
  overview() {
    return this.reports.overview();
  }

  @Get('costs/trend')
  trend(@Query('days') days?: string) {
    return this.reports.trend(days ? Number(days) : 30);
  }

  @Get('costs/breakdown')
  breakdown(@Query() query: BreakdownQueryDto) {
    return this.reports.breakdown(query.by, parsePeriod(query.from, query.to));
  }

  @Get('costs/assistants/:chatbotId')
  assistant(
    @Param('chatbotId', ParseUUIDPipe) chatbotId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.reports.assistant(chatbotId, parsePeriod(from, to));
  }

  @ApiOperation({ summary: "A period's usage events as CSV" })
  @Get('costs/export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="ally-usage.csv"')
  exportCsv(@Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.exportCsv(parsePeriod(from, to));
  }

  @ApiOperation({ summary: 'Budget and alert thresholds, in dollars' })
  @Get('costs/settings')
  settings() {
    return this.catalogue.settingsUsd();
  }

  @Put('costs/settings')
  async updateSettings(
    @Body() dto: CostSettingsDto,
    @CurrentUser() user: TokenUser,
  ) {
    await this.catalogue.updateSettings(dto, user?.id ?? null);
    return this.catalogue.settingsUsd();
  }

  @Get('costs/fixed')
  fixedCosts(@Query('month') month?: string) {
    return this.catalogue.fixedCosts(month);
  }

  @Post('costs/fixed')
  addFixedCost(@Body() dto: FixedCostDto, @CurrentUser() user: TokenUser) {
    return this.catalogue.saveFixedCost(dto, user?.id ?? null);
  }

  @Put('costs/fixed/:id')
  editFixedCost(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FixedCostDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.catalogue.saveFixedCost({ ...dto, id }, user?.id ?? null);
  }

  @Delete('costs/fixed/:id')
  deleteFixedCost(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: NoteDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.catalogue.deleteFixedCost(id, dto.note, user?.id ?? null);
  }

  @ApiOperation({
    summary: 'The history of every CR1 admin change of one kind',
  })
  @Get('history')
  historyOf(@Query('subject') subject: string, @Query('id') id?: string) {
    return this.audit.historyOf(subject ?? 'model', id);
  }
}
