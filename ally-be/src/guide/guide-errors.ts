import {
  BadRequestException,
  ForbiddenException,
  HttpStatus,
} from '@nestjs/common';
import { ErrorCode } from 'src/exception/error-code.enum';

/**
 * The guide's HTTP refusals. Each body carries `errorCode`, which
 * `CustomExceptionFilter` lifts onto the JSON response — the only extra field
 * it passes through, so anything else put in the body never reaches a client.
 */
export const guideDisabled = () =>
  new ForbiddenException({
    statusCode: HttpStatus.FORBIDDEN,
    message: 'Ally is not available for this course',
    error: 'Forbidden',
    errorCode: ErrorCode.GUIDE_DISABLED,
  });

export const guideNoAccess = () =>
  new ForbiddenException({
    statusCode: HttpStatus.FORBIDDEN,
    message: 'You do not have access to this course',
    error: 'Forbidden',
    errorCode: ErrorCode.GUIDE_NO_ACCESS,
  });

export const guideMessageTooLong = (maxChars: number) =>
  new BadRequestException({
    statusCode: HttpStatus.BAD_REQUEST,
    message: `Messages can be up to ${maxChars} characters`,
    error: 'Bad Request',
    errorCode: ErrorCode.GUIDE_MESSAGE_TOO_LONG,
  });
