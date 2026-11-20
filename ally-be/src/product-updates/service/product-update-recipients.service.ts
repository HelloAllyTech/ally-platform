import { ConflictException, Injectable } from '@nestjs/common';

import { ExecutionManager } from 'src/common/execution/execution-manager';
import { NotFoundException } from 'src/exception/custom.exception';
import { LoggerService } from 'src/logger/logger.service';

import { DigestRecipientsDto } from '../dto/product-update.dto';
import { ProductUpdateDigestRecipientRepository } from '../repository/product-update-digest-recipient.repository';

/** Postgres unique-violation. */
const UNIQUE_VIOLATION = '23505';

/**
 * Who the daily digest goes to: the addresses managed in the admin console
 * (Roadmap → Updates). The database is the only source.
 */
@Injectable()
export class ProductUpdateRecipientsService {
  private readonly logger = LoggerService.getInstance(
    ProductUpdateRecipientsService.name,
  );

  constructor(
    private readonly recipientRepository: ProductUpdateDigestRecipientRepository,
  ) {}

  async list(): Promise<DigestRecipientsDto> {
    const rows = await this.recipientRepository.find({
      order: { createdAt: 'ASC', email: 'ASC' },
    });
    return {
      recipients: rows.map((row) => ({
        id: row.id,
        email: row.email,
        addedAt: row.createdAt.toISOString(),
      })),
    };
  }

  /** Every address the digest goes to. */
  async effective(): Promise<string[]> {
    const rows = await this.recipientRepository.find({
      select: { email: true },
    });
    return rows.map((row) => row.email);
  }

  async add(rawEmail: string): Promise<DigestRecipientsDto> {
    const email = rawEmail.trim().toLowerCase();
    if (await this.recipientRepository.exists({ where: { email } })) {
      throw new ConflictException(`${email} already gets the daily email.`);
    }
    try {
      await this.recipientRepository.save(
        this.recipientRepository.create({ email, addedBy: this.userId() }),
      );
    } catch (error) {
      // Two admins adding the same address at once.
      if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
        throw new ConflictException(`${email} already gets the daily email.`);
      }
      throw error;
    }
    this.logger.info(
      `[PRODUCT-UPDATES] Digest recipient added by user ${this.userId()}: ${email}`,
    );
    return this.list();
  }

  async remove(id: string): Promise<DigestRecipientsDto> {
    const row = await this.recipientRepository.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Recipient not found');
    await this.recipientRepository.delete({ id });
    this.logger.info(
      `[PRODUCT-UPDATES] Digest recipient removed by user ${this.userId()}: ${row.email}`,
    );
    return this.list();
  }

  private userId(): number | null {
    const id = ExecutionManager.getUserId();
    return id ? Number(id) : null;
  }
}
