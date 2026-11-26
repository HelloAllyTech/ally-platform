import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type {
  AgentGatewayTool,
  AgentToolContext,
  AgentToolOutcome,
} from './tools';

export interface SendSourceFileInput {
  title: string;
}

/** WhatsApp sends these as documents (Meta's list); anything else is not offered. */
const SENDABLE_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
];

export interface SendableSource {
  id: string;
  title: string;
  fileUrl: string;
  fileName: string | null;
  contentType: string;
  sizeBytes: number | null;
}

/**
 * `send_source_file` (WA-A §2): when someone asks for one of the assistant's own documents ("send
 * me the form"), the agent names it by title and ally-be sends the file after the reply, on
 * WhatsApp, by a short-lived link. Only an uploaded file among this assistant's own sources
 * (owned by it, or selected for it), never anything else; a title that matches none is an
 * answer the agent reads (`no_such_file`, with the titles it can send). Nothing is sent from here:
 * the channel sends it once the reply has gone, so the file never arrives first. An assistant
 * opts in with `abilities.send_source_file = do_it`.
 */
@Injectable()
export class SendSourceFileTool implements AgentGatewayTool<SendSourceFileInput> {
  readonly name = 'send_source_file';

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  parse(input: Record<string, unknown>): SendSourceFileInput {
    const unknown = Object.keys(input).filter((key) => key !== 'title');
    if (unknown.length) {
      throw new BadRequestException(`Unknown fields: ${unknown.join(', ')}`);
    }
    const title = input.title;
    if (typeof title !== 'string' || !title.trim() || title.length > 300) {
      throw new BadRequestException('title must be the source title');
    }
    return { title: title.trim() };
  }

  async run(
    ctx: AgentToolContext,
    { title }: SendSourceFileInput,
  ): Promise<AgentToolOutcome> {
    const sources = await this.sendable(ctx.chatbotId);
    const wanted = title.toLowerCase();
    const match =
      sources.find((s) => s.title.toLowerCase() === wanted) ??
      sources.find(
        (s) =>
          s.title.toLowerCase().includes(wanted) ||
          (s.fileName ?? '').toLowerCase().includes(wanted),
      );
    if (!match) {
      return {
        ok: false,
        error: 'no_such_file',
        result: { files: sources.slice(0, 10).map((s) => s.title) },
      };
    }
    // The file goes after the reply; the agent says it's on its way.
    return {
      ok: true,
      result: { document_id: match.id, title: match.title, will_send: true },
    };
  }

  /** This assistant's own uploaded sources that WhatsApp can send. */
  async sendable(chatbotId: string): Promise<SendableSource[]> {
    const rows = (await this.dataSource.query(
      `SELECT d.id, d.title, d.file_url, d.file_name, d.content_type, d.size_bytes
         FROM kb_documents d
        WHERE d.file_url IS NOT NULL AND d.archived_at IS NULL
          AND d.content_type = ANY($2::text[])
          AND (d.owner_chatbot_id = $1
               OR d.id IN (SELECT cd.document_id FROM chatbot_documents cd
                            WHERE cd.chatbot_id = $1))
        ORDER BY d.title
        LIMIT 50`,
      [chatbotId, SENDABLE_TYPES],
    )) as {
      id: string;
      title: string;
      file_url: string;
      file_name: string | null;
      content_type: string;
      size_bytes: string | number | null;
    }[];
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      fileUrl: r.file_url,
      fileName: r.file_name,
      contentType: r.content_type,
      sizeBytes: r.size_bytes == null ? null : Number(r.size_bytes),
    }));
  }
}
