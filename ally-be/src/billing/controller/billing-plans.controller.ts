import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
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
  AddSeatsDto,
  NoteDto,
  PlanDto,
  SeatTypeChangeDto,
  SeatTypeDto,
} from '../dto/billing-admin.dto';
import { PlanService } from '../service/plan.service';

/**
 * Ally admin → Plans (CR1 Part C): plans and seat types as data, renewals due, and seats on any
 * assistant. Super admins only (`manage_costs`, server-checked). Every change needs a note.
 */
@ApiTags('Billing (Ally admin)')
@ApiBearerAuth()
@ApiSecurity('access-token')
@RequireFeatureToggle(FeatureToggleKey.MANAGE_COSTS)
@Controller('v1/admin/billing')
export class BillingPlansController {
  constructor(private readonly plans: PlanService) {}

  @ApiOperation({
    summary: 'Plans, seat types and extra seats renewing in the next 7 days',
  })
  @Get('plans')
  catalogue() {
    return this.plans.catalogue();
  }

  @Post('plans')
  addPlan(@Body() dto: PlanDto, @CurrentUser() user: TokenUser) {
    return this.plans.savePlan(dto, user?.id ?? null);
  }

  @Put('plans/:id')
  editPlan(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PlanDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.plans.savePlan({ ...dto, id }, user?.id ?? null);
  }

  @Post('seat-types')
  addSeatType(@Body() dto: SeatTypeDto, @CurrentUser() user: TokenUser) {
    return this.plans.saveSeatType(dto, user?.id ?? null);
  }

  @Put('seat-types/:id')
  editSeatType(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SeatTypeDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.plans.saveSeatType({ ...dto, id }, user?.id ?? null);
  }

  @ApiOperation({
    summary: 'Add extra seats to an assistant (type, count, start date)',
  })
  @Post('assistants/:chatbotId/seats')
  addSeats(
    @Param('chatbotId', ParseUUIDPipe) chatbotId: string,
    @Body() dto: AddSeatsDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.plans.addSeats(chatbotId, dto, user?.id ?? null);
  }

  @Post('seats/:seatId/renew')
  renew(
    @Param('seatId', ParseUUIDPipe) seatId: string,
    @Body() dto: NoteDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.plans.renewSeat(seatId, dto.note, user?.id ?? null);
  }

  @Post('seats/:seatId/cancel')
  cancel(
    @Param('seatId', ParseUUIDPipe) seatId: string,
    @Body() dto: NoteDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.plans.cancelSeat(seatId, dto.note, user?.id ?? null);
  }

  @Put('seats/:seatId/type')
  changeType(
    @Param('seatId', ParseUUIDPipe) seatId: string,
    @Body() dto: SeatTypeChangeDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.plans.changeSeatType(
      seatId,
      dto.seatTypeKey,
      dto.note,
      user?.id ?? null,
    );
  }
}
