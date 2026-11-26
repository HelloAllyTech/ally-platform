import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';

import { CrmContact } from '../entity/crm-contact.entity';

@Injectable()
export class CrmContactRepository extends Repository<CrmContact> {
  constructor(private readonly dataSource: DataSource) {
    super(CrmContact, dataSource.createEntityManager());
  }
}
