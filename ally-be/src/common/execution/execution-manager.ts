import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';
import { Request } from 'express';

interface ExecutionContext {
  id: string;
  startTime: string;
  origin?: string;
  userId?: string;
  role?: string;
  tenantId?: string;
  path?: string;
  ip?: string;
  method?: string;
  originalUrl?: string;
  headers?: { [key: string]: string | string[] | undefined } | undefined;
  /**
   * Assistants stage 8: set by the chatbot member guard after a staff read was logged, so the
   * services' own view checks on that one chatbot pass for this request (view only, never edit).
   */
  staffView?: StaffViewContext;
}

export interface StaffViewContext {
  chatbotId: string;
  staffUserId: number;
  /** The live owner grant this read used, when it read conversations. */
  grantId: string | null;
}

export class ExecutionManager {
  private static storage = new AsyncLocalStorage<ExecutionContext>();

  static runWithContext<T>(fn: () => T, req?: Request | { path: string }): T {
    const contextData = {
      id: randomUUID(),
      startTime: new Date().toISOString(),
      ...(req && {
        path: req.path,
        headers: 'headers' in req ? req.headers : {},
        ip: 'ip' in req ? req.ip : undefined,
        method: 'method' in req ? req.method : undefined,
        originalUrl: 'originalUrl' in req ? req.originalUrl : undefined,
      }),
    };
    return this.storage.run(contextData, fn);
  }

  static setAuthContext(userId: string, tenantId: string): void {
    const context = this.storage.getStore();
    if (context) {
      context.userId = userId;
      context.tenantId = tenantId;
    }
  }

  /** Returns false when there is no request context to hold it (the staff read is then refused). */
  static setStaffView(view: StaffViewContext): boolean {
    const context = this.storage.getStore();
    if (!context) return false;
    context.staffView = view;
    return true;
  }

  static getStaffView(): StaffViewContext | undefined {
    return this.storage.getStore()?.staffView;
  }

  static getCurrentContext(): ExecutionContext | undefined {
    return this.storage.getStore();
  }

  static getUserId(): string | undefined {
    return this.storage.getStore()?.userId;
  }

  static getTenantId(): string | undefined {
    return this.storage.getStore()?.tenantId;
  }

  static getPath(): string | undefined {
    return this.storage.getStore()?.path;
  }

  static getExecutionId(): string | undefined {
    return this.storage.getStore()?.id;
  }

  static getRequestMetadata():
    | {
        ip?: string;
        method?: string;
        originalUrl?: string;
        headers?: { [key: string]: string | string[] | undefined };
      }
    | undefined {
    const context = this.storage.getStore();
    if (!context) return undefined;

    return {
      ip: context.ip,
      method: context.method,
      originalUrl: context.originalUrl,
      headers: context.headers,
    };
  }
}
