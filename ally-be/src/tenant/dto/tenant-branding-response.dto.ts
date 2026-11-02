import { ApiProperty } from '@nestjs/swagger';
import {
  BrandColourRamp,
  TenantBrandingResolved,
  TenantBrandingTokens,
} from '../type/tenant-branding.types';

export class BrandColourRampDto implements BrandColourRamp {
  @ApiProperty({ example: '#264D8E' }) DEFAULT!: string;
  @ApiProperty({ example: '#EEF1F6' }) 50!: string;
  @ApiProperty({ example: '#DCE3ED' }) 100!: string;
  @ApiProperty({ example: '#BAC6DB' }) 200!: string;
  @ApiProperty({ example: '#93A6C7' }) 300!: string;
  @ApiProperty({ example: '#637FAE' }) 400!: string;
  @ApiProperty({ example: '#264D8E' }) 500!: string;
  @ApiProperty({ example: '#1F3F74' }) 600!: string;
  @ApiProperty({ example: '#183159' }) 700!: string;
  @ApiProperty({ example: '#10203C' }) 800!: string;
  @ApiProperty({ example: '#0A1425' }) 900!: string;
}

export class TenantBrandingTokensDto implements TenantBrandingTokens {
  @ApiProperty({ type: BrandColourRampDto }) primary!: BrandColourRampDto;
  @ApiProperty({ example: '#FAF9F5' }) onPrimary!: string;
}

/** Resolved branding: always complete, Ally defaults when the org switch is off. */
export class TenantBrandingResponseDto implements TenantBrandingResolved {
  @ApiProperty({ example: false }) enabled!: boolean;
  @ApiProperty({ example: 'Acme Helpline' }) displayName!: string;
  @ApiProperty({ nullable: true, example: null }) logoUrl!: string | null;
  @ApiProperty({ nullable: true, example: null }) faviconUrl!: string | null;
  @ApiProperty({ example: '#264D8E' }) primaryColor!: string;
  @ApiProperty({ nullable: true, example: null }) welcomeLine!: string | null;
  @ApiProperty({ example: true }) poweredByAlly!: true;
  @ApiProperty({ type: TenantBrandingTokensDto })
  tokens!: TenantBrandingTokensDto;
}

/** PATCH result: the new resolved branding plus anything the admin should know. */
export class UpdateTenantBrandingResponseDto {
  @ApiProperty({ type: TenantBrandingResponseDto })
  branding!: TenantBrandingResponseDto;

  @ApiProperty({
    type: [String],
    description:
      'Non-blocking notes, e.g. a colour that passes 3:1 but not 4.5:1.',
  })
  warnings!: string[];
}
