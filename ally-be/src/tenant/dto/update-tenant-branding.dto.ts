import { ApiProperty } from '@nestjs/swagger';
import { IsOptional } from 'class-validator';

/**
 * PATCH /v1/tenants/:id/branding body. Shape-checked here for Swagger; the
 * real rules (lengths, hex, contrast, assets-bucket URL) live in
 * `validateBrandingPatch`, which also produces the warnings the admin sees.
 * Null clears a field back to the Ally default. `enabled` is deliberately
 * absent — it is the org-level switch on the org edit form, super-admin only.
 */
export class UpdateTenantBrandingDto {
  @ApiProperty({
    required: false,
    nullable: true,
    maxLength: 60,
    description: 'Shown in place of the registered org name. Null = org name.',
  })
  @IsOptional()
  displayName?: string | null;

  @ApiProperty({
    required: false,
    nullable: true,
    example: '#264D8E',
    description:
      'One brand colour, #RRGGBB. Refused below 3:1 against the page ' +
      'background; warned below 4.5:1. Null = Ally Blue.',
  })
  @IsOptional()
  primaryColor?: string | null;

  @ApiProperty({
    required: false,
    nullable: true,
    description:
      'URL returned by POST /v1/tenants/:id/branding/favicon-url. Null = Ally favicon.',
  })
  @IsOptional()
  faviconUrl?: string | null;

  @ApiProperty({
    required: false,
    nullable: true,
    maxLength: 160,
    description: 'One line under the logo on the login and talker pages.',
  })
  @IsOptional()
  welcomeLine?: string | null;
}
