import { Injectable, NestMiddleware, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response, NextFunction } from 'express';
import * as geoip from 'geoip-lite';

@Injectable()
export class GeoBlockMiddleware implements NestMiddleware {
  private readonly blockedCountries: string[];

  constructor(private config: ConfigService) {
    const raw = this.config.get<string>('BLOCKED_COUNTRIES', 'RU,CN,KP,IR,BY');
    this.blockedCountries = raw.split(',').map((c) => c.trim().toUpperCase());
  }

  use(req: Request, _res: Response, next: NextFunction) {
    const forwarded = req.headers['x-forwarded-for'];
    const rawIp = Array.isArray(forwarded)
      ? forwarded[0]
      : (forwarded ?? req.socket.remoteAddress ?? '');
    const ip = rawIp.split(',')[0].trim();

    const geo = geoip.lookup(ip);
    if (geo && this.blockedCountries.includes(geo.country)) {
      throw new ForbiddenException('Service nicht verfügbar in deiner Region.');
    }
    next();
  }
}
