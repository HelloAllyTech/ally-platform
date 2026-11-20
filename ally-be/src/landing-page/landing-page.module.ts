import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthorizationModule } from 'src/authorization/authorization.module';
import { AwsModule } from 'src/aws/aws.module';
import { Tenant } from 'src/tenant/entity/tenant.entity';

import {
  LandingPageController,
  LandingPagePublicController,
} from './controller/landing-page.controller';
import { LandingPage } from './entity/landing-page.entity';
import { LandingPageService } from './service/landing-page.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([LandingPage, Tenant]),
    AwsModule,
    AuthorizationModule,
  ],
  controllers: [LandingPagePublicController, LandingPageController],
  providers: [LandingPageService],
  exports: [LandingPageService],
})
export class LandingPageModule {}
