import { JwtAuthGuard } from '../jwt-auth.guard';
import { Reflector } from '@nestjs/core';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JsonWebTokenError } from 'jsonwebtoken';

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new JwtAuthGuard(reflector);
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  describe('canActivate', () => {
    it('should return true for a public route', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
      const context = {
        getHandler: () => {},
        getClass: () => {},
      } as unknown as ExecutionContext;

      expect(guard.canActivate(context)).toBe(true);
    });
  });

  describe('handleRequest', () => {
    it('should return the user when token is valid', () => {
      const user = { id: 1, username: 'test' };
      expect(guard.handleRequest(null, user, null)).toBe(user);
    });

    it('should throw UnauthorizedException when user is not present', () => {
      expect(() => guard.handleRequest(null, null, null)).toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException with "Token expired" message when token has expired', () => {
      const info = new JsonWebTokenError('jwt expired');
      expect(() => guard.handleRequest(null, null, info)).toThrow(
        new UnauthorizedException('Token expired'),
      );
    });

    it('should throw UnauthorizedException with a specific message for other JWT errors', () => {
      const info = new JsonWebTokenError('invalid token');
      expect(() => guard.handleRequest(null, null, info)).toThrow(
        new UnauthorizedException('invalid token'),
      );
    });

    it('should throw UnauthorizedException with the error message for generic errors', () => {
      const info = new Error('Some other error');
      expect(() => guard.handleRequest(null, null, info)).toThrow(
        new UnauthorizedException('Some other error'),
      );
    });
  });
});
