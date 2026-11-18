import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/auth.metadata';
import { Observable } from 'rxjs';
import { LoggerService } from 'src/logger/logger.service';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  private readonly logger = LoggerService.getInstance(JwtAuthGuard.name);

  constructor(private reflector: Reflector) {
    super();
  }

  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }
    return super.canActivate(context);
  }

  handleRequest(err: any, user: any, info: any) {
    if (info?.name === 'JsonWebTokenError') {
      if (info.message === 'jwt expired') {
        throw new UnauthorizedException('Token expired');
      } else {
        this.logger.warn(`JWT error: ${info.message}`, info);
        throw new UnauthorizedException(info.message);
      }
    }
    if (info instanceof Error) {
      this.logger.warn(`Auth error: ${info.message}`, info);
      throw new UnauthorizedException(info.message);
    }
    if (err || !user) {
      this.logger.warn(
        `Unauthorized access attempt: err=${String(err)}, info=${JSON.stringify(
          info,
        )}`,
      );
      throw err || new UnauthorizedException();
    }
    return user;
  }
}
