import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PrismaService } from '../common/prisma.service';
import { EmailSendService } from '../email/email-send.service';
import { QUEUE_EMAIL_INGEST } from '../queue/queue.module';

const COUNTRY_TLDS: Record<string, string[]> = {
  RU: ['.ru', '.рф'],
  CN: ['.cn'],
  KP: ['.kp'],
  IR: ['.ir'],
  BY: ['.by'],
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly blockedTlds: string[];

  constructor(
    private prisma: PrismaService,
    private emailSend: EmailSendService,
    private config: ConfigService,
    @InjectQueue(QUEUE_EMAIL_INGEST) private ingestQueue: Queue,
  ) {
    const countries = this.config
      .get<string>('BLOCKED_COUNTRIES', 'RU,CN,KP,IR,BY')
      .split(',')
      .map((c) => c.trim().toUpperCase());
    this.blockedTlds = countries.flatMap((c) => COUNTRY_TLDS[c] ?? []);
  }

  isDomainBlocked(email: string): boolean {
    const domain = '@' + (email.split('@')[1] ?? '').toLowerCase();
    return this.blockedTlds.some((tld) => domain.endsWith(tld));
  }

  async register(firstName: string, lastName: string, email: string): Promise<void> {
    email = email.toLowerCase().trim();
    if (this.isDomainBlocked(email)) {
      throw new BadRequestException('E-Mail-Domain aus gesperrter Region nicht erlaubt.');
    }

    const existing = await this.prisma.user.findUnique({ where: { email } });

    if (existing?.verified) {
      throw new ConflictException('E-Mail-Adresse bereits registriert und verifiziert.');
    }

    const verificationToken = crypto.randomUUID().replace(/-/g, '');
    const baseUrl = this.config.get<string>('APP_BASE_URL', 'https://meetingbutler.de');
    const verifyUrl = `${baseUrl}/api/auth/verify?token=${verificationToken}`;

    if (existing) {
      await this.prisma.user.update({
        where: { email },
        data: { firstName, lastName, verificationToken },
      });
    } else {
      await this.prisma.user.create({
        data: { firstName, lastName, email, verificationToken },
      });
    }

    const body = [
      `Hallo ${firstName},`,
      ``,
      `bitte bestätige deine E-Mail-Adresse, um Meetingbutler nutzen zu können:`,
      ``,
      `${verifyUrl}`,
      ``,
      `Nach der Bestätigung kannst du E-Mails an meetings@meetingbutler.de weiterleiten und bekommst automatisch .ics-Kalendereinladungen zurück.`,
      ``,
      `— Meetingbutler.de`,
    ].join('\n');

    await this.emailSend.sendSimpleMail(
      email,
      '[Meetingbutler] Bitte bestätige deine E-Mail-Adresse',
      body,
    );
  }

  async verify(token: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { verificationToken: token },
    });

    if (!user) {
      throw new NotFoundException('Ungültiger oder bereits verwendeter Bestätigungslink.');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { verified: true, verificationToken: null },
    });

    // Retroactively process any emails that arrived before the user verified
    const pending = await this.prisma.rawEmail.findMany({
      where: { fromAddress: user.email, processed: false, pendingSource: { not: null } },
    });

    if (pending.length > 0) {
      this.logger.log(`Re-enqueueing ${pending.length} pending email(s) for newly verified user ${user.email}`);
      for (const raw of pending) {
        await this.ingestQueue.add(
          'process-email',
          { uid: 0, source: raw.pendingSource },
          { jobId: `pending-${raw.id}` },
        );
      }
    }

    return user.firstName;
  }
}
