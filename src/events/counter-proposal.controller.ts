import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import { Response } from 'express';
import { PrismaService } from '../common/prisma.service';
import { IcsService } from '../ics/ics.service';
import { EmailSendService } from '../email/email-send.service';

@Controller('api/events/counter')
export class CounterProposalController {
  constructor(
    private prisma: PrismaService,
    private ics: IcsService,
    private emailSend: EmailSendService,
  ) {}

  @Get(':token/accept')
  async accept(@Param('token') token: string, @Res() res: Response) {
    const proposal = await this.prisma.counterProposal.findUnique({
      where: { token },
      include: { event: true },
    });
    if (!proposal) throw new NotFoundException();
    if (proposal.status !== 'pending') {
      return res.status(410).send('<p>Dieser Link wurde bereits verwendet.</p>');
    }

    const updatedEvent = await this.prisma.event.update({
      where: { id: proposal.eventId },
      data: {
        startDatetime: proposal.proposedStart,
        endDatetime: proposal.proposedEnd,
        sequence: proposal.event.sequence + 1,
      },
    });

    await this.prisma.counterProposal.update({
      where: { id: proposal.id },
      data: { status: 'accepted' },
    });

    await this.prisma.auditLog.create({
      data: {
        eventId: proposal.eventId,
        action: 'counter_accepted',
        details: { token, proposerEmail: proposal.proposerEmail } as any,
      },
    });

    const icsContent = this.ics.generate(updatedEvent, [], null);
    for (const to of [proposal.proposerEmail, proposal.event.organizerEmail]) {
      await this.emailSend.sendEventEmail({
        to,
        isUpdate: true,
        event: updatedEvent,
        icsContent,
        attachmentIds: [],
      });
    }

    return res.status(200).send('<p>Termin wurde aktualisiert. Alle Teilnehmer wurden benachrichtigt.</p>');
  }

  @Get(':token/decline')
  async decline(@Param('token') token: string, @Res() res: Response) {
    const proposal = await this.prisma.counterProposal.findUnique({
      where: { token },
      include: { event: true },
    });
    if (!proposal) throw new NotFoundException();
    if (proposal.status !== 'pending') {
      return res.status(410).send('<p>Dieser Link wurde bereits verwendet.</p>');
    }

    await this.prisma.counterProposal.update({
      where: { id: proposal.id },
      data: { status: 'declined' },
    });

    await this.prisma.auditLog.create({
      data: {
        eventId: proposal.eventId,
        action: 'counter_declined',
        details: { token, proposerEmail: proposal.proposerEmail } as any,
      },
    });

    await this.emailSend.sendCounterDeclineNotification(proposal.event, proposal);

    return res.status(200).send('<p>Vorschlag wurde abgelehnt.</p>');
  }
}
