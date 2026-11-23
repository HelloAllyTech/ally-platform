import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { DirectoryController } from '../directory.controller';

describe('DirectoryController', () => {
  it('authenticates every route, since each handler reads the caller from request.user', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, DirectoryController);
    expect(guards).toContain(JwtAuthGuard);
  });
});
