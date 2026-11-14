export interface ScheduledTask {
  interval: string;
  taskName: string;
  handler: () => Promise<void>;
}

/**
 * A task whose schedule is data, not a fixed @Cron tick (Debrief › Settings ›
 * Schedules). Its owner decides when it is due and runs it; the handler may
 * return a short summary of what it did ("3 approvals expired") for the run log.
 */
export interface ConfigurableTask {
  key: string;
  handler: () => Promise<string | void>;
}

class ScheduledTaskRegistry {
  private handlers: Map<string, ScheduledTask[]> = new Map();
  private configurable: Map<string, ConfigurableTask> = new Map();

  register(
    interval: string,
    taskName: string,
    handler: () => Promise<void>,
  ): void {
    if (!this.handlers.has(interval)) {
      this.handlers.set(interval, []);
    }
    this.handlers.get(interval)!.push({ interval, taskName, handler });
  }

  getHandlers(interval: string): ScheduledTask[] {
    return this.handlers.get(interval) ?? [];
  }

  /**
   * Register a task the fixed intervals do not run: its schedule lives in the
   * database (`debrief_schedules`) and `DebriefScheduleService` runs it when due.
   */
  registerConfigurable(
    key: string,
    handler: () => Promise<string | void>,
  ): void {
    this.configurable.set(key, { key, handler });
  }

  getConfigurable(key: string): ConfigurableTask | undefined {
    return this.configurable.get(key);
  }
}

export const scheduledTaskRegistry = new ScheduledTaskRegistry();
