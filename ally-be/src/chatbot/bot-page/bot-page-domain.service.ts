import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import { promises as dnsPromises } from 'dns';
import * as psl from 'psl';
import { Raw, Repository } from 'typeorm';
import { registerPublicBotOriginCheck } from '../../common/cors/app-cors';
import { ExecutionManager } from '../../common/execution/execution-manager';
import { AppConfigService } from '../../config/config.service';
import {
  ChatbotDomain,
  ChatbotDomainStatus,
  DomainCheckResult,
  DomainStepResult,
} from '../entity/chatbot-domain.entity';
import { BotPageService } from './bot-page.service';

/** The TXT record's name is `_ally-verify.<host>`; its value `ally-verify=<token>`. */
export const DOMAIN_VERIFY_PREFIX = '_ally-verify';
/** One custom domain per chatbot: the default `/chat/<id>` address always works besides it. */
export const MAX_DOMAINS_PER_CHATBOT = 1;

const HOSTNAME =
  /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;

/** What `node:dns` answers; replaceable in tests. */
export interface DnsResolver {
  resolveCname(host: string): Promise<string[]>;
  resolveTxt(host: string): Promise<string[][]>;
  resolve4(host: string): Promise<string[]>;
}

/** The records the owner adds, exactly as their DNS provider asks for them. */
export interface DomainRecord {
  type: 'CNAME' | 'TXT';
  /** The full name (`chat.example.org`, `_ally-verify.chat.example.org`). */
  name: string;
  value: string;
}

export interface DomainView {
  id: string;
  host: string;
  status: ChatbotDomainStatus;
  records: DomainRecord[];
  lastCheck: DomainCheckResult | null;
  checkedAt: string | null;
  verifiedAt: string | null;
  /** The page's address on this domain once it is ready. */
  url: string;
}

const NOT_THERE = new Set(['ENODATA', 'ENOTFOUND', 'ENONAME', 'NXDOMAIN']);

const clean = (name: string): string => name.toLowerCase().replace(/\.$/, '');

/**
 * Custom domains for the bot page (stage 7): add a host, show the two DNS records, check them live.
 * Certificates and routing the host to the page are infrastructure (docs/custom-domains.md); a
 * verified domain is what the proxy may ask about (`isServed`), and what the public routes and
 * CORS accept as the page's own origin (`originAllowedFor`).
 */
@Injectable()
export class BotPageDomainService implements OnModuleInit {
  resolver: DnsResolver = dnsPromises;
  /** host → chatbot id (or null), for the origin check on every public request. */
  private readonly cache = new Map<
    string,
    { chatbotId: string | null; until: number }
  >();

  constructor(
    @InjectRepository(ChatbotDomain)
    private readonly domains: Repository<ChatbotDomain>,
    private readonly pages: BotPageService,
    private readonly config: AppConfigService,
  ) {}

  onModuleInit(): void {
    registerPublicBotOriginCheck((origin, key) =>
      this.originAllowedFor(origin, key),
    );
  }

  /** "https://Chat.Example.org/x" → "chat.example.org", or a 400 that says what is wrong. */
  normaliseHost(raw: string): string {
    let host = (raw ?? '').trim().toLowerCase();
    host = host
      .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
      .replace(/[/?#].*$/, '')
      .replace(/:\d+$/, '')
      .replace(/\.$/, '');
    if (!HOSTNAME.test(host)) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'domain_invalid',
        message:
          'Enter a web address like chat.yourclinic.org, without https:// or a path.',
      });
    }
    const parsed = psl.parse(host);
    if (
      ('error' in parsed && parsed.error) ||
      !(parsed as psl.ParsedDomain).domain
    ) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'domain_shared',
        message:
          'That address is shared by many sites. Use a domain your organisation owns.',
      });
    }
    const own = this.config.botPage.domainTarget;
    const ownParsed = own ? psl.parse(own) : null;
    const ownDomain =
      ownParsed && !('error' in ownParsed && ownParsed.error)
        ? (ownParsed as psl.ParsedDomain).domain
        : null;
    if (ownDomain && (host === ownDomain || host.endsWith(`.${ownDomain}`))) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'domain_ours',
        message: 'That address already belongs to Ally. Use your own domain.',
      });
    }
    return host;
  }

  async list(chatbotId: string): Promise<DomainView[]> {
    const rows = await this.domains.find({
      where: { chatbotId },
      order: { createdAt: 'ASC' },
    });
    return rows.map((row) => this.view(row));
  }

  async add(chatbotId: string, raw: string): Promise<DomainView> {
    const host = this.normaliseHost(raw);
    const taken = await this.domains.findOne({
      where: { host: Raw((alias) => `lower(${alias}) = :host`, { host }) },
    });
    if (taken) {
      if (taken.chatbotId === chatbotId) return this.view(taken);
      throw new ConflictException({
        statusCode: 409,
        error: 'domain_taken',
        message: 'That address is already used by another assistant.',
      });
    }
    if (
      (await this.domains.count({ where: { chatbotId } })) >=
      MAX_DOMAINS_PER_CHATBOT
    ) {
      throw new ConflictException({
        statusCode: 409,
        error: 'domain_limit',
        message: 'Remove the current domain before adding another.',
      });
    }
    const userId = Number(ExecutionManager.getUserId() ?? 0) || null;
    try {
      const row = await this.domains.save(
        this.domains.create({
          chatbotId,
          host,
          verificationToken: randomBytes(16).toString('hex'),
          status: ChatbotDomainStatus.PENDING,
          lastCheck: null,
          checkedAt: null,
          verifiedAt: null,
          createdBy: userId,
        }),
      );
      return this.view(row);
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new ConflictException({
          statusCode: 409,
          error: 'domain_taken',
          message: 'That address is already used by another assistant.',
        });
      }
      throw error;
    }
  }

  async remove(chatbotId: string, id: string): Promise<void> {
    const row = await this.require(chatbotId, id);
    await this.domains.delete({ id: row.id });
    this.cache.delete(row.host.toLowerCase());
  }

  /**
   * The live check: the CNAME (or, on a root domain whose provider flattens it, the same
   * addresses as Ally's host) and the TXT token. Both right: verified. Otherwise failed, with
   * what DNS answered for each, so the screen can say exactly what to fix.
   */
  async check(chatbotId: string, id: string): Promise<DomainView> {
    const row = await this.require(chatbotId, id);
    const result: DomainCheckResult = {
      cname: await this.checkCname(row.host),
      txt: await this.checkTxt(row.host, row.verificationToken),
    };
    const ok = result.cname.state === 'ok' && result.txt.state === 'ok';
    row.lastCheck = result;
    row.checkedAt = new Date();
    row.status = ok ? ChatbotDomainStatus.VERIFIED : ChatbotDomainStatus.FAILED;
    row.verifiedAt = ok ? (row.verifiedAt ?? new Date()) : null;
    await this.domains.save(row);
    this.cache.delete(row.host.toLowerCase());
    return this.view(row);
  }

  /** For the TLS front door's on-demand certificates: only verified domains. */
  async isServed(raw: string | undefined): Promise<boolean> {
    if (!raw) return false;
    return Boolean(await this.verifiedChatbotFor(clean(raw)));
  }

  /**
   * Whether a browser on `origin` may call the public routes of the page `key` names: the origin's
   * host is a verified custom domain of that same chatbot. With no key (a route that names none),
   * any verified domain.
   */
  async originAllowedFor(
    origin: string,
    key?: string | null,
  ): Promise<boolean> {
    let host: string;
    try {
      const url = new URL(origin);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
      host = clean(url.hostname);
    } catch {
      return false;
    }
    const chatbotId = await this.verifiedChatbotFor(host);
    if (!chatbotId) return false;
    if (!key) return true;
    const page = await this.pages.findByKey(key);
    return Boolean(page && page.chatbotId === chatbotId);
  }

  private async verifiedChatbotFor(host: string): Promise<string | null> {
    const cached = this.cache.get(host);
    if (cached && cached.until > Date.now()) return cached.chatbotId;
    const row = await this.domains.findOne({
      where: {
        host: Raw((alias) => `lower(${alias}) = :host`, { host }),
        status: ChatbotDomainStatus.VERIFIED,
      },
    });
    const chatbotId = row?.chatbotId ?? null;
    this.cache.set(host, { chatbotId, until: Date.now() + 60_000 });
    if (this.cache.size > 5000) this.cache.clear();
    return chatbotId;
  }

  private async checkCname(host: string): Promise<DomainStepResult> {
    const target = clean(this.config.botPage.domainTarget);
    try {
      const found = (await this.resolver.resolveCname(host)).map(clean);
      return { state: found.includes(target) ? 'ok' : 'wrong', found };
    } catch (error) {
      if (!NOT_THERE.has((error as { code?: string }).code ?? '')) {
        return { state: 'error', found: [] };
      }
    }
    // No CNAME. A root domain can't have one; providers that flatten it (ALIAS/ANAME) answer
    // with Ally's addresses instead, which is just as good.
    try {
      const [mine, ours] = await Promise.all([
        this.resolver.resolve4(host),
        this.resolver.resolve4(target),
      ]);
      if (mine.length && mine.every((ip) => ours.includes(ip))) {
        return { state: 'ok', found: mine };
      }
      return { state: mine.length ? 'wrong' : 'missing', found: mine };
    } catch (error) {
      return NOT_THERE.has((error as { code?: string }).code ?? '')
        ? { state: 'missing', found: [] }
        : { state: 'error', found: [] };
    }
  }

  private async checkTxt(
    host: string,
    token: string,
  ): Promise<DomainStepResult> {
    const expected = `ally-verify=${token}`;
    try {
      const found = (
        await this.resolver.resolveTxt(`${DOMAIN_VERIFY_PREFIX}.${host}`)
      ).map((parts) => parts.join(''));
      if (found.includes(expected)) return { state: 'ok', found };
      return { state: found.length ? 'wrong' : 'missing', found };
    } catch (error) {
      return NOT_THERE.has((error as { code?: string }).code ?? '')
        ? { state: 'missing', found: [] }
        : { state: 'error', found: [] };
    }
  }

  private async require(chatbotId: string, id: string): Promise<ChatbotDomain> {
    const row = await this.domains.findOne({ where: { id, chatbotId } });
    if (!row)
      throw new NotFoundException('That domain is not on this assistant.');
    return row;
  }

  private view(row: ChatbotDomain): DomainView {
    return {
      id: row.id,
      host: row.host,
      status: row.status,
      records: [
        {
          type: 'CNAME',
          name: row.host,
          value: this.config.botPage.domainTarget,
        },
        {
          type: 'TXT',
          name: `${DOMAIN_VERIFY_PREFIX}.${row.host}`,
          value: `ally-verify=${row.verificationToken}`,
        },
      ],
      lastCheck: row.lastCheck ?? null,
      checkedAt: row.checkedAt ? new Date(row.checkedAt).toISOString() : null,
      verifiedAt: row.verifiedAt
        ? new Date(row.verifiedAt).toISOString()
        : null,
      url: `https://${row.host}`,
    };
  }
}
