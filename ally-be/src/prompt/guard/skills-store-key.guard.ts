import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SkillsStoreKeyScope } from '../entity/skills-store-key.entity';
import { SkillsStoreKeyService } from '../service/skills-store-key.service';

export const SKILLS_STORE_SCOPE = 'skills-store-scope';

/** Header the `prompts` CLI sends its key in. */
export const SKILLS_STORE_KEY_HEADER = 'x-skills-store-key';

/** Require a Skills Store key with this scope. */
export const RequireSkillsStoreScope = (scope: SkillsStoreKeyScope) =>
  SetMetadata(SKILLS_STORE_SCOPE, scope);

/**
 * Accepts a Skills Store key (`x-skills-store-key`) carrying the route's
 * scope. Puts the key on `request.skillsStoreKey` so the handler can record
 * who wrote a version.
 */
@Injectable()
export class SkillsStoreKeyGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly keys: SkillsStoreKeyService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const scope =
      this.reflector.getAllAndOverride<SkillsStoreKeyScope>(
        SKILLS_STORE_SCOPE,
        [context.getHandler(), context.getClass()],
      ) ?? SkillsStoreKeyScope.PULL;
    const request = context.switchToHttp().getRequest();
    const presented = request.headers[SKILLS_STORE_KEY_HEADER] as
      | string
      | undefined;
    request.skillsStoreKey = await this.keys.verify(presented, scope);
    return true;
  }
}
