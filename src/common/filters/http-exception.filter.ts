import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Request, Response } from 'express';
import { ErrorCodes } from '../constants';

/**
 * Uniform error envelope:
 *   { success: false, error: { code, message, details? }, meta: { traceId, timestamp } }
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('exceptions');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();
    const traceId = (request as any).traceId;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: string = ErrorCodes.INTERNAL;
    let message = 'Unexpected server error';
    let details: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse() as any;
      if (typeof body === 'string') {
        message = body;
      } else {
        code = body?.code ?? defaultCodeForStatus(status);
        message = body?.message ?? exception.message;
        details = body?.details;
        // class-validator output: { statusCode, message: string[], error }
        if (Array.isArray(body?.message)) {
          code = ErrorCodes.VALIDATION_FAILED;
          message = 'Request validation failed';
          details = body.message;
        }
      }
    } else if (exception instanceof Error && exception.message === 'INVALID_CLIENT_REFERENCE') {
      status = HttpStatus.BAD_REQUEST;
      code = ErrorCodes.INVALID_REFERENCE;
      message = 'Client reference must be 1-15 alphanumeric characters';
    }

    if (status >= 500) {
      this.logger.error(`Unhandled exception on ${request.method} ${request.url}`, (exception as any)?.stack ?? exception);
    }

    response.status(status).json({
      success: false,
      error: {
        code,
        message,
        ...(details !== undefined ? { details } : {}),
      },
      meta: { traceId, timestamp: new Date().toISOString() },
    });
  }
}

function defaultCodeForStatus(status: number): string {
  switch (status) {
    case HttpStatus.BAD_REQUEST: return ErrorCodes.VALIDATION_FAILED;
    case HttpStatus.UNAUTHORIZED: return ErrorCodes.UNAUTHORIZED;
    case HttpStatus.FORBIDDEN: return ErrorCodes.FORBIDDEN;
    case HttpStatus.NOT_FOUND: return ErrorCodes.NOT_FOUND;
    case HttpStatus.CONFLICT: return ErrorCodes.CONFLICT;
    case HttpStatus.TOO_MANY_REQUESTS: return ErrorCodes.RATE_LIMITED;
    default: return ErrorCodes.INTERNAL;
  }
}
