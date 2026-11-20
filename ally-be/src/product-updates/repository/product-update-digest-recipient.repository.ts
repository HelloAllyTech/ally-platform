import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';

import { ProductUpdateDigestRecipient } from '../entity/product-update-digest-recipient.entity';

@Injectable()
export class ProductUpdateDigestRecipientRepository extends Repository<ProductUpdateDigestRecipient> {
  constructor(private readonly dataSource: DataSource) {
    super(ProductUpdateDigestRecipient, dataSource.createEntityManager());
  }
}
