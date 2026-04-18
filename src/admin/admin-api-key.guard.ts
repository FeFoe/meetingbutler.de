import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

@Injectable()
export class AdminApiKeyGuard implements CanActivate {
  constructor(private config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const authHeader = req.headers['authorization'] ?? '';
    const expected = this.config.get<string>('ADMIN_API_KEY');

    if (!expected) {
      throw new UnauthorizedException('Admin API key not configured');
    }

    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
    if (!token || token !== expected) {
      throw new UnauthorizedException('Invalid or missing admin API key');
    }

    return true;
  }
}
