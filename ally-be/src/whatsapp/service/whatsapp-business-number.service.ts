import { randomBytes } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { Connector } from 'src/chatbot/entity/connector.entity';
import { ChatbotMemberRole } from 'src/chatbot/enum/chatbot.enum';
import { ChatbotAccessService } from 'src/chatbot/service/chatbot-access.service';
import { ConnectorService } from 'src/chatbot/service/connector.service';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { AppConfigService } from 'src/config/config.service';
import { LoggerService } from 'src/logger/logger.service';
import { Tenant } from 'src/tenant/entity/tenant.entity';
import { WaBusinessNumber } from '../entity/wa-business-number.entity';
import {
  WaBusinessNumberSource,
  WaBusinessNumberStatus,
} from '../enum/whatsapp.enum';
import {
  WaNumberCredentials,
  WHATSAPP_PROVIDER,
  WhatsAppConnectionCheck,
  WhatsAppProvider,
} from '../type/whatsapp-provider.interface';
import { WhatsAppCredentialCipherService } from './whatsapp-credential-cipher.service';

const CREDS_CACHE_TTL_MS = 60_000;

/**
 * The number an inbound message was sent to, with what the pipeline needs to answer it.
 *
 * `id` and `connectorId` are null for the env-configured platform number, which has no row: the
 * bot that answers it is the `platformChatbotId` in the default settings.
 */
export interface ResolvedWaNumber {
  id: string | null;
  tenantId: string | null;
  connectorId: string | null;
  creds: WaNumberCredentials;
}

/** What the admin screen sees. Never the token or the app secret. */
export interface WaBusinessNumberView {
  id: string;
  connectorId: string | null;
  /** The bot the number answers for, if it is bound to one. */
  chatbotId: string | null;
  chatbotName: string | null;
  /** The organisation that connected it, for numbers connected before chatbots. */
  tenantId: string | null;
  tenantName: string | null;
  phoneNumberId: string;
  wabaId: string;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  source: WaBusinessNumberSource;
  status: WaBusinessNumberStatus;
  lastCheckedAt: Date | null;
  lastError: string | null;
  /** Where the number's Meta app must send webhooks. Manual numbers only. */
  callbackUrl: string | null;
  verifyToken: string | null;
  hasAppSecret: boolean;
  /** When the number last received a message — the proof the whole setup works end to end. */
  lastInboundAt: Date | null;
  createdAt: Date;
}

export interface ConnectManualInput {
  /** Bind to this bot straight away (its owners may do this); none leaves the number free. */
  chatbotId?: string | null;
  phoneNumberId: string;
  wabaId: string;
  accessToken: string;
  appSecret: string;
}

/**
 * WhatsApp numbers — the WhatsApp connector's own store: connecting, checking, and finding the
 * right one for a webhook.
 *
 * Each number belongs to a connector, and access follows the bot the connector serves: a bot's
 * owners manage its number, platform admins manage every number including free ones, and a number
 * the caller cannot see answers exactly like one that does not exist.
 */
@Injectable()
export class WhatsAppBusinessNumberService {
  private readonly logger = LoggerService.getInstance(
    WhatsAppBusinessNumberService.name,
  );
  private readonly credsCache = new Map<
    string,
    { creds: WaNumberCredentials; expiresAt: number }
  >();

  constructor(
    @InjectRepository(WaBusinessNumber)
    private readonly numberRepository: Repository<WaBusinessNumber>,
    @InjectRepository(Tenant)
    private readonly tenantRepository: Repository<Tenant>,
    @Inject(WHATSAPP_PROVIDER)
    private readonly provider: WhatsAppProvider,
    @InjectRepository(Connector)
    private readonly connectorRepository: Repository<Connector>,
    private readonly cipher: WhatsAppCredentialCipherService,
    private readonly access: ChatbotAccessService,
    private readonly connectors: ConnectorService,
    private readonly config: AppConfigService,
  ) {}

  // ───────────────────────────────────────────────────────────── message path

  /** The env-configured platform number, as a resolved number. */
  platformNumber(): ResolvedWaNumber {
    const { phoneNumberId, accessToken, businessAccountId } =
      this.config.whatsapp;
    return {
      id: null,
      tenantId: null,
      connectorId: null,
      creds: { phoneNumberId, accessToken, businessAccountId },
    };
  }

  /**
   * Which number a message on the SHARED webhook was sent to.
   *
   * The env number first, so a platform number that also has a row by mistake keeps behaving as
   * the platform's. Only Embedded Signup numbers live on Ally's app and arrive here; a MANUAL
   * number's webhooks come through its own URL, and a payload claiming one on the shared path is
   * not answered — its signature was checked with the wrong app's secret.
   */
  async resolveForSharedWebhook(
    phoneNumberId: string | undefined,
  ): Promise<ResolvedWaNumber | null> {
    const envId = this.config.whatsapp.phoneNumberId;
    if (!phoneNumberId || phoneNumberId === envId) {
      return envId || !phoneNumberId ? this.platformNumber() : null;
    }
    const row = await this.numberRepository.findOne({
      where: {
        phoneNumberId,
        source: WaBusinessNumberSource.EMBEDDED_SIGNUP,
        deletedAt: IsNull(),
      },
    });
    return row ? this.toResolved(row) : null;
  }

  /** Resolve a number for a queued message. The webhook already decided it may be answered. */
  async resolveForInbound(
    phoneNumberId: string | undefined,
  ): Promise<ResolvedWaNumber | null> {
    if (
      !phoneNumberId ||
      phoneNumberId === this.config.whatsapp.phoneNumberId
    ) {
      return this.platformNumber();
    }
    const row = await this.numberRepository.findOne({
      where: { phoneNumberId, deletedAt: IsNull() },
    });
    return row ? this.toResolved(row) : null;
  }

  /**
   * Credentials to reply with, for a contact's number. Cached briefly per process: a reply path
   * sends up to three times per message and the decrypt is not free. A disconnect clears this
   * process's entry at once; other instances follow within the TTL.
   */
  async credentialsFor(
    businessNumberId: string | null | undefined,
  ): Promise<WaNumberCredentials | null> {
    if (!businessNumberId) return this.platformNumber().creds;
    const cached = this.credsCache.get(businessNumberId);
    if (cached && cached.expiresAt > Date.now()) return cached.creds;
    const row = await this.numberRepository.findOne({
      where: { id: businessNumberId, deletedAt: IsNull() },
    });
    if (!row) {
      this.credsCache.delete(businessNumberId);
      return null;
    }
    const { creds } = await this.toResolved(row);
    this.credsCache.set(businessNumberId, {
      creds,
      expiresAt: Date.now() + CREDS_CACHE_TTL_MS,
    });
    return creds;
  }

  /** The live manual number that owns a per-number webhook URL. */
  async findByWebhookKey(webhookKey: string): Promise<WaBusinessNumber | null> {
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(webhookKey)) return null;
    return this.numberRepository.findOne({
      where: { webhookKey, deletedAt: IsNull() },
    });
  }

  async appSecretFor(row: WaBusinessNumber): Promise<string | undefined> {
    return row.appSecretEnc
      ? this.cipher.decrypt(row.appSecretEnc, 'app secret')
      : undefined;
  }

  /** Meta completed the handshake on this number's URL — the setup step we cannot check ourselves. */
  async markWebhookVerified(row: WaBusinessNumber): Promise<void> {
    if (row.status === WaBusinessNumberStatus.AWAITING_WEBHOOK) {
      await this.numberRepository.update(
        { id: row.id },
        { status: WaBusinessNumberStatus.CONNECTED, lastError: null },
      );
      if (row.connectorId) {
        await this.connectors.setStatus(
          row.connectorId,
          WaBusinessNumberStatus.CONNECTED,
        );
      }
      this.logger.info(`WhatsApp number ${row.id} webhook verified by Meta`);
    }
  }

  private async toResolved(row: WaBusinessNumber): Promise<ResolvedWaNumber> {
    return {
      id: row.id,
      tenantId: row.tenantId ?? null,
      connectorId: row.connectorId ?? null,
      creds: {
        phoneNumberId: row.phoneNumberId,
        businessAccountId: row.wabaId,
        accessToken: await this.cipher.decrypt(
          row.accessTokenEnc,
          'access token',
        ),
      },
    };
  }

  // ───────────────────────────────────────────────────────────── admin

  /**
   * One bot's numbers (any member of it), or every number including free ones (platform admins).
   */
  async list(chatbotId?: string): Promise<WaBusinessNumberView[]> {
    let connectorIds: string[] | null = null;
    if (chatbotId) {
      await this.access.assert(chatbotId, ChatbotMemberRole.VIEWER);
      const rows = await this.connectorRepository.find({
        where: { chatbotId, type: 'whatsapp', deletedAt: IsNull() },
        select: ['id'],
      });
      connectorIds = rows.map((r) => r.id);
      if (!connectorIds.length) return [];
    } else {
      await this.access.assertPlatformAdmin();
    }
    const rows = await this.numberRepository.find({
      where: {
        deletedAt: IsNull(),
        ...(connectorIds ? { connectorId: In(connectorIds) } : {}),
      },
      order: { createdAt: 'ASC' },
    });
    return this.toViews(rows);
  }

  /** By connector, for the connector type's summaries. */
  async findByConnectorIds(connectorIds: string[]): Promise<WaBusinessNumber[]> {
    if (!connectorIds.length) return [];
    return this.numberRepository.find({
      where: { connectorId: In(connectorIds), deletedAt: IsNull() },
    });
  }

  async lastInboundAt(numberIds: string[]): Promise<Map<string, Date>> {
    if (!numberIds.length) return new Map();
    const rows = await this.numberRepository.manager.query<
      { number_id: string; last_at: Date }[]
    >(
      `SELECT c.business_number_id AS number_id, MAX(m."createdAt") AS last_at
         FROM wa_messages m
         JOIN wa_contacts c ON c.id = m.contact_id
        WHERE m.direction = 'inbound' AND c.business_number_id = ANY($1::uuid[])
        GROUP BY 1`,
      [numberIds],
    );
    return new Map(rows.map((r) => [r.number_id, r.last_at]));
  }

  /**
   * Connect a number from a Meta app, as a new WhatsApp connector.
   *
   * Checked against Meta BEFORE anything is stored: a typo'd id or a 24-hour token that has
   * already expired is far easier to fix in the form than as a row that silently never answers.
   * With `chatbotId` the connector is bound to that bot (its owners may do this); without, it is a
   * free number only platform admins can see until it is given to a bot.
   */
  async connectManual(
    input: ConnectManualInput,
  ): Promise<WaBusinessNumberView> {
    if (input.chatbotId) {
      await this.access.assert(input.chatbotId, ChatbotMemberRole.OWNER);
    } else {
      await this.access.assertPlatformAdmin();
    }
    if (!this.cipher.configured) {
      throw new BadRequestException(
        'WhatsApp credential encryption is not configured on the server (WHATSAPP_CREDENTIALS_ENCRYPTION_KEY).',
      );
    }

    const phoneNumberId = input.phoneNumberId.trim();
    const wabaId = input.wabaId.trim();
    const accessToken = input.accessToken.trim();
    const appSecret = input.appSecret.trim();

    if (phoneNumberId === this.config.whatsapp.phoneNumberId) {
      throw new ConflictException(
        "That is the platform number configured on the server; it is already answered by the platform's chatbot.",
      );
    }
    const claimed = await this.numberRepository.findOne({
      where: { phoneNumberId, deletedAt: IsNull() },
    });
    if (claimed) {
      throw new ConflictException(
        'That WhatsApp number is already connected. Add it to this chatbot from Channels instead.',
      );
    }

    const check = await this.checkWith({
      phoneNumberId,
      businessAccountId: wabaId,
      accessToken,
    });
    if (!check.ok) {
      throw new BadRequestException(
        `Meta did not accept these details: ${check.error ?? 'unknown error'}`,
      );
    }

    const display = check.phoneNumber?.displayPhoneNumber ?? null;
    const connector = await this.connectors.create({
      type: 'whatsapp',
      name: `WhatsApp ${display ?? phoneNumberId}`,
      chatbotId: input.chatbotId ?? null,
      status: WaBusinessNumberStatus.AWAITING_WEBHOOK,
    });

    const userId = Number(ExecutionManager.getUserId() ?? 0);
    const row = await this.numberRepository.save(
      this.numberRepository.create({
        tenantId: null,
        connectorId: connector.id,
        phoneNumberId,
        wabaId,
        displayPhoneNumber: display,
        verifiedName: check.phoneNumber?.verifiedName ?? null,
        accessTokenEnc: await this.cipher.encrypt(accessToken),
        appSecretEnc: await this.cipher.encrypt(appSecret),
        webhookKey: randomBytes(24).toString('base64url'),
        verifyToken: randomBytes(24).toString('hex'),
        source: WaBusinessNumberSource.MANUAL,
        status: WaBusinessNumberStatus.AWAITING_WEBHOOK,
        lastCheckedAt: new Date(),
        lastError: null,
        createdBy: userId,
        updatedBy: userId,
      }),
    );
    this.logger.info(
      `WhatsApp number ${row.id} connected as connector ${connector.id}` +
        (input.chatbotId ? ` for chatbot ${input.chatbotId}` : ''),
    );
    return this.view(row.id);
  }

  async get(id: string): Promise<WaBusinessNumberView> {
    const row = await this.getInScope(id, ChatbotMemberRole.VIEWER);
    return this.view(row.id);
  }

  /** Re-check with Meta and record the result on the row. */
  async check(id: string): Promise<{
    number: WaBusinessNumberView;
    check: WhatsAppConnectionCheck;
  }> {
    const row = await this.getInScope(id, ChatbotMemberRole.OWNER);
    const resolved = await this.toResolved(row).catch(() => null);
    const check: WhatsAppConnectionCheck = resolved
      ? await this.checkWith(resolved.creds)
      : {
          ok: false,
          error:
            'The stored access token cannot be read. Disconnect and connect the number again.',
          subscribedApps: null,
        };

    const patch: Partial<WaBusinessNumber> = {
      lastCheckedAt: new Date(),
      lastError: check.ok ? null : (check.error ?? 'unknown error'),
      updatedBy: Number(ExecutionManager.getUserId() ?? 0),
    };
    if (check.ok) {
      patch.displayPhoneNumber =
        check.phoneNumber?.displayPhoneNumber ?? row.displayPhoneNumber;
      patch.verifiedName = check.phoneNumber?.verifiedName ?? row.verifiedName;
      if (row.status === WaBusinessNumberStatus.ERROR) {
        patch.status = WaBusinessNumberStatus.CONNECTED;
      }
    } else {
      patch.status = WaBusinessNumberStatus.ERROR;
    }
    await this.numberRepository.update({ id: row.id }, patch);
    if (row.connectorId && patch.status) {
      await this.connectors.setStatus(row.connectorId, patch.status);
    }
    return { number: await this.view(row.id), check };
  }

  /** Subscribe the token's app to the number's WhatsApp account, so Meta delivers messages. */
  async subscribe(id: string): Promise<WaBusinessNumberView> {
    const row = await this.getInScope(id, ChatbotMemberRole.OWNER);
    const { creds } = await this.toResolved(row);
    if (!this.provider.subscribeApp) {
      throw new BadRequestException('This provider has no subscription step.');
    }
    await this.provider.subscribeApp(creds);
    return this.view(row.id);
  }

  /**
   * Disconnect through the connector, so the generic record and the number go together. A number
   * from before connectors (no connector) is wiped directly.
   */
  async disconnect(id: string): Promise<void> {
    const row = await this.getInScope(id, ChatbotMemberRole.OWNER);
    if (row.connectorId) {
      await this.connectors.disconnect(row.connectorId);
    } else {
      await this.wipe(row);
    }
  }

  /** The WhatsApp side of a disconnect: credentials wiped, not merely hidden. */
  async wipeForConnector(connectorId: string): Promise<void> {
    const row = await this.numberRepository.findOne({
      where: { connectorId, deletedAt: IsNull() },
    });
    if (row) await this.wipe(row);
  }

  /** The row stays (soft-deleted) so the log can still say which number a thread came in on. */
  private async wipe(row: WaBusinessNumber): Promise<void> {
    await this.numberRepository.update(
      { id: row.id },
      {
        accessTokenEnc: '',
        appSecretEnc: null,
        updatedBy: Number(ExecutionManager.getUserId() ?? 0),
      },
    );
    await this.numberRepository.softDelete({ id: row.id });
    this.credsCache.delete(row.id);
    this.logger.info(`WhatsApp number ${row.id} disconnected`);
  }

  private async checkWith(
    creds: WaNumberCredentials,
  ): Promise<WhatsAppConnectionCheck> {
    if (!this.provider.checkConnection) {
      return { ok: true, subscribedApps: null };
    }
    return this.provider.checkConnection(creds);
  }

  private async getInScope(
    id: string,
    minRole: ChatbotMemberRole,
  ): Promise<WaBusinessNumber> {
    const row = await this.numberRepository.findOne({
      where: { id, deletedAt: IsNull() },
    });
    if (!row) throw new NotFoundException('WhatsApp number not found');
    if (row.connectorId) {
      await this.connectors.getVisible(row.connectorId, minRole).catch(() => {
        throw new NotFoundException('WhatsApp number not found');
      });
    } else if (!(await this.access.isPlatformAdmin())) {
      throw new NotFoundException('WhatsApp number not found');
    }
    return row;
  }

  private async view(id: string): Promise<WaBusinessNumberView> {
    const row = await this.numberRepository.findOneOrFail({ where: { id } });
    return (await this.toViews([row]))[0];
  }

  private async toViews(rows: WaBusinessNumber[]): Promise<WaBusinessNumberView[]> {
    const connectorIds = rows.map((r) => r.connectorId).filter(Boolean) as string[];
    const [tenantNames, lastInbound, connectorRows] = await Promise.all([
      this.tenantNames(rows.map((r) => r.tenantId).filter(Boolean) as string[]),
      this.lastInboundAt(rows.map((r) => r.id)),
      connectorIds.length
        ? this.connectorRepository.find({
            where: { id: In(connectorIds) },
            select: ['id', 'chatbotId'],
          })
        : Promise.resolve([] as Connector[]),
    ]);
    const botByConnector = new Map(connectorRows.map((c) => [c.id, c.chatbotId ?? null]));
    const botIds = [...new Set([...botByConnector.values()].filter(Boolean))] as string[];
    const botNames = new Map<string, string>(
      botIds.length
        ? (
            await this.numberRepository.manager.query<{ id: string; name: string }[]>(
              `SELECT id, name FROM chatbots WHERE id = ANY($1::uuid[])`,
              [botIds],
            )
          ).map((b) => [b.id, b.name])
        : [],
    );
    return rows.map((row) => {
      const chatbotId = row.connectorId
        ? (botByConnector.get(row.connectorId) ?? null)
        : null;
      return {
        ...this.toView(row),
        chatbotId,
        chatbotName: chatbotId ? (botNames.get(chatbotId) ?? null) : null,
        tenantName: row.tenantId ? (tenantNames.get(row.tenantId) ?? null) : null,
        lastInboundAt: lastInbound.get(row.id) ?? null,
      };
    });
  }

  private async tenantNames(ids: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    if (!unique.length) return new Map();
    const tenants = await this.tenantRepository.find({
      where: { id: In(unique) },
      select: ['id', 'name'],
    });
    return new Map(tenants.map((t) => [String(t.id), t.name]));
  }

  private toView(row: WaBusinessNumber): WaBusinessNumberView {
    const manual = row.source === WaBusinessNumberSource.MANUAL;
    const base = (this.config.api.baseUrl ?? '').replace(/\/$/, '');
    return {
      id: row.id,
      connectorId: row.connectorId ?? null,
      chatbotId: null,
      chatbotName: null,
      tenantId: row.tenantId ?? null,
      tenantName: null,
      phoneNumberId: row.phoneNumberId,
      wabaId: row.wabaId,
      displayPhoneNumber: row.displayPhoneNumber ?? null,
      verifiedName: row.verifiedName ?? null,
      source: row.source,
      status: row.status,
      lastCheckedAt: row.lastCheckedAt ?? null,
      lastError: row.lastError ?? null,
      callbackUrl: manual
        ? `${base}/api/v1/webhook/whatsapp/${row.webhookKey}`
        : null,
      verifyToken: manual ? row.verifyToken : null,
      hasAppSecret: Boolean(row.appSecretEnc),
      lastInboundAt: null,
      createdAt: row.createdAt,
    };
  }
}
