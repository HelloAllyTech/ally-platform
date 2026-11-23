import type { BuilderSession } from '../entity/builder-session.entity';
import type { BuilderToolExecutionOutcome } from '../type/builder-sse.type';

/**
 * Extra, read-only tools for a Roadmap plan session's interview (a session of
 * kind `plan`), offered by a module Builder does not import.
 *
 * Same one-way dependency as `builderRequesters`: the roadmap depends on
 * Builder, never the reverse, so the roadmap registers its tools here at
 * module init and the interview's tool belt reads them. Builder knows nothing
 * about ideas; it only appends the definitions to a plan session's belt and
 * hands a call it does not recognise to whichever provider claims the name.
 *
 * Every provider must be read-only and must answer as the turn's caller
 * (`ctx.userId`) may read, because a tool result reaches the model and from
 * there anyone who can read the session.
 */
export interface BuilderPlanToolProvider {
  /** Tool definitions, appended after Builder's own (a stable order: the belt is cached). */
  definitions(): any[];
  handles(name: string): boolean;
  execute(
    name: string,
    input: Record<string, any>,
    ctx: { session: BuilderSession; userId: number },
  ): Promise<BuilderToolExecutionOutcome>;
}

class BuilderPlanToolRegistry {
  private readonly providers: BuilderPlanToolProvider[] = [];

  register(provider: BuilderPlanToolProvider): void {
    if (!this.providers.includes(provider)) this.providers.push(provider);
  }

  definitions(): any[] {
    return this.providers.flatMap((p) => p.definitions());
  }

  providerFor(name: string): BuilderPlanToolProvider | null {
    return this.providers.find((p) => p.handles(name)) ?? null;
  }

  /** For specs. */
  clear(): void {
    this.providers.length = 0;
  }
}

export const builderPlanTools = new BuilderPlanToolRegistry();
