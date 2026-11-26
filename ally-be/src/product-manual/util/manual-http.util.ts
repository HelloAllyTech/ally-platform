import {
  BadRequestException,
  HttpException,
  HttpStatus,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { ManualWriteError } from '../type/manual.types';

/** A `ManualWriteError` as the HTTP error a client should see; anything else is rethrown as is. */
export function manualErrorToHttp(error: unknown): unknown {
  if (!(error instanceof ManualWriteError)) return error;
  switch (error.code) {
    case 'not_found':
      return new NotFoundException(error.message);
    case 'too_large':
      return new PayloadTooLargeException(error.message);
    case 'scrubbed':
      return new HttpException(error.message, HttpStatus.UNPROCESSABLE_ENTITY);
    default:
      return new BadRequestException(error.message);
  }
}

/** `?limit=` as an integer in [min, max], or `fallback` when absent or not a number. */
export function parseLimit(
  raw: unknown,
  fallback: number,
  max: number,
): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, max);
}
