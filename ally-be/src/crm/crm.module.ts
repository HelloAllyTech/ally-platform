import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CrmController } from './controller/crm.controller';
import { CrmContactLog } from './entity/crm-contact-log.entity';
import { CrmContact } from './entity/crm-contact.entity';
import { CrmContactLogRepository } from './repository/crm-contact-log.repository';
import { CrmContactRepository } from './repository/crm-contact.repository';
import { CrmService } from './service/crm.service';

/**
 * Contacts: the admin console's minimal shared CRM. Gated by the
 * `crm_contacts` feature toggle; see CrmController.
 */
@Module({
  imports: [TypeOrmModule.forFeature([CrmContact, CrmContactLog])],
  controllers: [CrmController],
  providers: [CrmContactRepository, CrmContactLogRepository, CrmService],
})
export class CrmModule {}
