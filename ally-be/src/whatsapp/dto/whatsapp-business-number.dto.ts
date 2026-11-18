import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import {
  WaBusinessNumberSource,
  WaBusinessNumberStatus,
} from '../enum/whatsapp.enum';

/** One bot's numbers. Omitted: every number, including free ones (platform admins only). */
export class WaNumberListQueryDto {
  @ApiPropertyOptional({ description: 'Chatbot id' })
  @IsOptional()
  @IsUUID()
  chatbotId?: string;
}

export class ConnectWaNumberManualDto {
  @ApiPropertyOptional({
    description:
      'Bind the number to this chatbot straight away. Omitted: a free number only platform admins see until it is given to a bot.',
  })
  @IsOptional()
  @IsUUID()
  chatbotId?: string;

  @ApiProperty({
    description:
      "Meta's Phone number ID (WhatsApp → API Setup), not the phone number itself",
    example: '1441842099003459',
  })
  @Matches(/^\s*\d{5,32}\s*$/, {
    message:
      'Phone number ID is the numeric id Meta shows, not the phone number',
  })
  phoneNumberId!: string;

  @ApiProperty({
    description: 'WhatsApp Business Account ID',
    example: '2021434015185010',
  })
  @Matches(/^\s*\d{5,32}\s*$/, {
    message: 'WhatsApp Business Account ID is the numeric id Meta shows',
  })
  wabaId!: string;

  @ApiProperty({
    description:
      'A permanent System User access token with whatsapp_business_messaging and ' +
      'whatsapp_business_management. Stored encrypted and never returned.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1024)
  accessToken!: string;

  @ApiProperty({
    description:
      "The Meta app's App secret (App settings → Basic). Used to verify that webhooks come from " +
      'Meta. Stored encrypted and never returned.',
  })
  @Matches(/^\s*[a-f0-9]{32}\s*$/i, {
    message: 'App secret is the 32-character value under App settings → Basic',
  })
  appSecret!: string;
}

export class WaBusinessNumberResponseDto {
  @ApiProperty() id!: string;
  @ApiPropertyOptional({ nullable: true }) connectorId!: string | null;
  @ApiPropertyOptional({ nullable: true }) chatbotId!: string | null;
  @ApiPropertyOptional({ nullable: true }) chatbotName!: string | null;
  @ApiPropertyOptional({ nullable: true }) tenantId!: string | null;
  @ApiPropertyOptional({ nullable: true }) tenantName!: string | null;
  @ApiProperty() phoneNumberId!: string;
  @ApiProperty() wabaId!: string;
  @ApiPropertyOptional({ nullable: true }) displayPhoneNumber!: string | null;
  @ApiPropertyOptional({ nullable: true }) verifiedName!: string | null;
  @ApiProperty({ enum: WaBusinessNumberSource })
  source!: WaBusinessNumberSource;
  @ApiProperty({ enum: WaBusinessNumberStatus })
  status!: WaBusinessNumberStatus;
  @ApiPropertyOptional({ nullable: true }) lastCheckedAt!: Date | null;
  @ApiPropertyOptional({ nullable: true }) lastError!: string | null;
  @ApiPropertyOptional({
    nullable: true,
    description:
      'Paste into the Meta app’s WhatsApp → Configuration → Callback URL',
  })
  callbackUrl!: string | null;
  @ApiPropertyOptional({ nullable: true }) verifyToken!: string | null;
  @ApiProperty() hasAppSecret!: boolean;
  @ApiPropertyOptional({
    nullable: true,
    description: 'When the number last received a message',
  })
  lastInboundAt!: Date | null;
  @ApiProperty() createdAt!: Date;
}
