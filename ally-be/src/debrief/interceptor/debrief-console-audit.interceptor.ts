import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { AuditLogService } from '../../audit/service/audit-log.service';

/** Query keys worth keeping: filters, never free text a person typed. */
const KEPT_QUERY = new Set([
  'mode',
  'status',
  'days',
  'kind',
  // Expert review's queue filters.
  'tenantId',
  'language',
  'sessionType',
  'source',
]);

/**
 * v9 FR-38 "Audit: every view writes an audit event". Each successful GET on
 * the Debrief Console records who looked at which view and which ids
 * (`DEBRIEF_CONSOLE_VIEWED`): the route, its path parameters and its filters.
 * Never the response — runs and flags quote transcripts. Writing the event
 * never delays or fails the view (`AuditLogService.log` swallows its errors).
 */
@Injectable()
export class DebriefConsoleAuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditLogService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    if (req?.method !== 'GET') return next.handle();
    return next.handle().pipe(
      tap(() => {
        const query = Object.fromEntries(
          Object.entries(req.query ?? {}).filter(([k]) => KEPT_QUERY.has(k)),
        );
        void this.audit.log({
          eventType: 'DEBRIEF_CONSOLE_VIEWED',
          userId: req.user?.id,
          details: {
            view: req.route?.path ?? req.path,
            params: req.params ?? {},
            ...(Object.keys(query).length ? { query } : {}),
          },
        });
      }),
    );
  }
}
