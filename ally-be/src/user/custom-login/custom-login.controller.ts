import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { IsEmail, IsInt, IsNotEmpty, IsString, Min } from 'class-validator';
import { CurrentUser } from 'src/auth/decorators/user.decorator';
import { RequireFeatureToggle } from 'src/auth/decorators/feature-toggle.decorator';
import { TokenUser } from 'src/auth/type/auth.types';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { CustomLoginService } from './custom-login.service';

export class AssignCustomLoginDto {
  @ApiProperty({ example: 123 })
  @IsInt()
  @Min(1)
  userId!: number;
}

export class CreateCustomLoginDto {
  @ApiProperty({ example: 'Asha Rao' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ example: 'asha@example.com' })
  @IsEmail({}, { message: 'Invalid email' })
  email!: string;

  @ApiProperty({ description: 'Tenant ID (UUID)' })
  @IsString()
  @IsNotEmpty()
  tenantId!: string;
}

/** Ally admin → Custom logins (CR1 Part B). Same gate as the Ally admins screen. */
@ApiTags('Custom logins')
@ApiBearerAuth()
@ApiSecurity('access-token')
@RequireFeatureToggle(FeatureToggleKey.ADMIN_USER_MANAGEMENT)
@Controller('v1/custom-logins')
export class CustomLoginController {
  constructor(private readonly service: CustomLoginService) {}

  @ApiOperation({ summary: 'List custom logins (Assistant owners)' })
  @Get()
  list(@Query('search') search?: string) {
    return this.service.list(search);
  }

  @ApiOperation({
    summary: 'Make a user a custom login (the Assistant owner role)',
  })
  @Post()
  assign(@Body() dto: AssignCustomLoginDto, @CurrentUser() user: TokenUser) {
    return this.service.assign(dto.userId, user.id);
  }

  @ApiOperation({
    summary: 'Create a new user directly as a custom login (Assistant owner)',
  })
  @Post('users')
  create(@Body() dto: CreateCustomLoginDto, @CurrentUser() user: TokenUser) {
    return this.service.create(dto, user.id);
  }

  @ApiOperation({ summary: 'Take the custom-login role away' })
  @Delete(':userId')
  remove(
    @Param('userId', ParseIntPipe) userId: number,
    @CurrentUser() user: TokenUser,
  ) {
    return this.service.remove(userId, user.id);
  }
}
