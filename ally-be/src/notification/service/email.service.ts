import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AppConfigService } from '../../config/config.service';
import { LoggerService } from '../../logger/logger.service';
import { SESService } from 'src/aws/service/ses.service';
import { AppType } from 'src/common/constants/user.constants';

@Injectable()
export class EmailService {
  private readonly logger = LoggerService.getInstance(EmailService.name);

  constructor(
    private readonly config: AppConfigService,
    private readonly eventEmitter: EventEmitter2,
    private readonly sesService: SESService,
  ) {}

  async sendEmailOTP(params: {
    to: string;
    otp: string;
    magicLinkToken?: string;
    appType?: AppType;
    /**
     * The org's branded display name, only when its branding switch is on.
     * The email then speaks in the org's name and carries a "Powered by
     * Ally" line, so a learner whose org brands the app recognises it.
     */
    orgName?: string;
    /** With orgName: the org's logo (if any) and brand colour, for the HTML email. */
    orgLogoUrl?: string;
    orgColor?: string;
  }): Promise<boolean> {
    if (this.config.isDevelopment) {
      // TODO: Remove this once email otp is verified in dev
      this.eventEmitter.emit('exception', {
        statusCode: 200,
        timestamp: new Date().toISOString(),
        path: '/api/v1/email/otp',
        message: 'OTP sent to ' + params.to + ' - ' + params.otp,
        type: 'EMAIL OTP',
        channel: 'C0AS8EM1SUT',
      });
    }
    const minutes = Math.floor(this.config.otp.ttl / 60);

    const baseUrl =
      params.appType === AppType.ADMIN
        ? this.config.app.adminBaseUrl
        : this.config.app.baseUrl;

    const magicLink = params.magicLinkToken
      ? `${baseUrl}/auth/verify?token=${params.magicLinkToken}`
      : undefined;

    const brand = params.orgName?.trim();
    const subject = brand
      ? `Your ${brand} sign-in code`
      : 'Your Ally Verification Code';

    // A branded org gets an HTML email with its logo and colour at the top;
    // the plain Ally email stays the plain text it has always been.
    const body = brand
      ? brandedOtpHtml({
          brand,
          logoUrl: params.orgLogoUrl,
          color: params.orgColor,
          otp: params.otp,
          magicLink,
          minutes,
        })
      : `Your Ally Verification Code is:
${params.otp}
${magicLink ? `Or click the link below to login instantly:\n${magicLink}\n` : ''}
⏱️ This security code is valid for the next ${minutes} minutes.
🚫 Do not share this code with anyone.
❌ If you did not request this code, you can safely ignore this email.
`;

    return this.sesService.sendEmail({
      from: this.config.email.sourceEmail,
      to: params.to,
      subject,
      body,
      isHtml: Boolean(brand),
      purpose: 'login OTP',
    });
  }

  /**
   * A bot page's one-time code (Agents v2, chunk 12b), in the page's name and colour. The visitor
   * asked for it on the bot's own link, so the email speaks for that page, with "Powered by Ally".
   * In development the code is echoed to Slack, as the sign-in code is, so it can be read locally.
   */
  async sendBotPageCode(params: {
    to: string;
    code: string;
    pageTitle: string;
    logoUrl?: string | null;
    accentColour?: string;
    minutes: number;
  }): Promise<boolean> {
    if (this.config.isDevelopment) {
      this.eventEmitter.emit('exception', {
        statusCode: 200,
        timestamp: new Date().toISOString(),
        path: '/api/v1/public/bots/otp',
        message: `Bot page code for ${params.to} - ${params.code}`,
        type: 'BOT PAGE OTP',
        channel: 'C0AS8EM1SUT',
      });
    }
    return this.sesService.sendEmail({
      from: this.config.email.sourceEmail,
      to: params.to,
      subject: `Your code for ${params.pageTitle}`,
      body: brandedOtpHtml({
        brand: params.pageTitle,
        logoUrl: params.logoUrl ?? undefined,
        color: params.accentColour,
        otp: params.code,
        minutes: params.minutes,
      }),
      isHtml: true,
      purpose: 'bot page code',
      maskRecipientsInLog: true,
    });
  }

  /**
   * A lead alert to one of a "Bring in customers" assistant's owners (Agents v2, chunk 20a-2). Plain
   * text from the copy deck; the recipient is masked in logs and the subject carries nothing about
   * the visitor.
   */
  async sendLeadAlert(params: {
    to: string;
    subject: string;
    body: string;
  }): Promise<boolean> {
    return this.sesService.sendEmail({
      from: this.config.email.sourceEmail,
      to: params.to,
      subject: params.subject,
      body: params.body,
      isHtml: false,
      purpose: 'lead alert',
      maskRecipientsInLog: true,
    });
  }

  async sendSummaryNotification(params: {
    to: string;
    chatId: number;
    summaryName?: string;
  }): Promise<boolean> {
    const subject = 'Your Ally Call Summary is Ready';
    const summaryLink = `${this.config.app.baseUrl}/summary/${params.chatId}?source=deeplink`;
    const body = `Hello,

Your call summary ${params.summaryName ? `for session ID: ${params.summaryName}` : ''} has been generated and is now available for review.

You can view the complete summary by clicking the link below:
${summaryLink}

Best regards,
The Ally Team`;

    return this.sesService.sendEmail({
      from: this.config.email.sourceEmail,
      to: params.to,
      subject,
      body,
      isHtml: false,
      purpose: 'summary ready',
    });
  }

  /**
   * Invite an AI Lab evaluator with their portal link and generated
   * credentials. These are low-sensitivity, single-purpose accounts (an
   * evaluator only sees runs assigned to them); the password is generated
   * server-side and shared here in place of the admin copying it manually.
   *
   * THROWS on failure (it used to resolve `false` and swallow everything, which
   * meant an evaluator could be created with a password nobody received while
   * the admin saw a clean success). `LabEvaluatorService.sendInvite` catches it
   * — the invite failing must not undo the evaluator row — but the failure is
   * now logged there and alerted from SESService.
   */
  async sendEvaluatorInvite(params: {
    to: string;
    password: string;
  }): Promise<boolean> {
    const portalUrl = `${this.config.app.adminBaseUrl}/evaluate`;
    const subject = "You've been invited to evaluate on Ally AI Lab";
    const body = `Hello,

You've been added as an evaluator on the Ally AI Lab. Sign in to review and score the records assigned to you:

${portalUrl}

Email: ${params.to}
Password: ${params.password}

Please keep these credentials private. If you weren't expecting this, you can ignore this email.

Best regards,
The Ally Team`;

    return this.sesService.sendEmail({
      from: this.config.email.sourceEmail,
      to: params.to,
      subject,
      body,
      isHtml: false,
      purpose: 'AI Lab evaluator invite',
    });
  }
}

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const HEX_COLOUR = /^#[0-9a-f]{6}$/i;
const ALLY_BLUE = '#264D8E';

/**
 * The branded sign-in email. Table layout and inline styles only, since
 * mail clients ignore most else; the org's colour is a strip across the top
 * and the border of the code box, so the message is recognisably the org's
 * without the colour carrying any text. Every org-supplied string is
 * escaped; the colour is used only if it is a plain #RRGGBB.
 */
export function brandedOtpHtml(input: {
  brand: string;
  logoUrl?: string;
  color?: string;
  otp: string;
  magicLink?: string;
  minutes: number;
}): string {
  const color = HEX_COLOUR.test(input.color ?? '') ? input.color! : ALLY_BLUE;
  const brand = escapeHtml(input.brand);
  const logo =
    input.logoUrl && /^https:\/\//.test(input.logoUrl)
      ? `<img src="${escapeHtml(input.logoUrl)}" alt="${brand}" height="48" style="display:block;height:48px;max-width:220px;object-fit:contain;margin:0 auto 12px;" />`
      : '';
  const magic = input.magicLink
    ? `<p style="margin:0 0 20px;font-size:15px;line-height:22px;color:#29261F;">Or sign in instantly: <a href="${escapeHtml(input.magicLink)}" style="color:${color};">${escapeHtml(input.magicLink)}</a></p>`
    : '';
  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#F5F4EE;font-family:Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#F5F4EE;padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:480px;background:#FFFFFF;border-radius:8px;overflow:hidden;">
<tr><td style="height:6px;background:${color};font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td style="padding:28px 32px 8px;text-align:center;">
${logo}<div style="font-size:18px;font-weight:bold;color:#29261F;">${brand}</div>
</td></tr>
<tr><td style="padding:16px 32px 0;">
<p style="margin:0 0 12px;font-size:15px;line-height:22px;color:#29261F;">Your ${brand} sign-in code is:</p>
<div style="margin:0 0 20px;padding:14px;border:2px solid ${color};border-radius:6px;text-align:center;font-size:28px;letter-spacing:6px;font-weight:bold;color:#29261F;">${escapeHtml(input.otp)}</div>
${magic}<p style="margin:0 0 6px;font-size:13px;line-height:20px;color:#5F5B52;">This code is valid for the next ${input.minutes} minutes.</p>
<p style="margin:0 0 6px;font-size:13px;line-height:20px;color:#5F5B52;">Do not share this code with anyone.</p>
<p style="margin:0 0 24px;font-size:13px;line-height:20px;color:#5F5B52;">If you did not request this code, you can safely ignore this email.</p>
</td></tr>
<tr><td style="padding:14px 32px;border-top:1px solid #E8E6DF;text-align:center;font-size:12px;color:#8A8578;">Powered by Ally</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}
