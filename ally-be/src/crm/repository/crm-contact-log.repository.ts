import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';

import { CrmContactLog } from '../entity/crm-contact-log.entity';

@Injectable()
export class CrmContactLogRepository extends Repository<CrmContactLog> {
  constructor(private readonly dataSource: DataSource) {
    super(CrmContactLog, dataSource.createEntityManager());
  }
}
