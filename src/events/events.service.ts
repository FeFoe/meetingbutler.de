import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { IcsService } from '../ics/ics.service';
import { EmailSendService } from '../email/email-send.service';
import { PdfService } from '../pdf/pdf.service';
import { UpdateEventDto } from './dto/update-event.dto';

@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);

  constructor(
    private prisma: PrismaService,
    private ics: IcsService,
    private emailSend: EmailSendService,
    private pdf: PdfService,
  ) {}

  findAll() {
    return this.prisma.event.findMany({
      include: { eventDetails: true, attachments: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  findOne(id: string) {
    return this.prisma.event.findUnique({
      where: { id },
      include: { eventDetails: true, attachments: true, auditLogs: true },
    });
  }

  async findByUid(uid: string) {
    const event = await this.prisma.event.findUnique({
      where: { uid },
      include: { eventDetails: true, attachments: true },
    });
    if (!event) throw new NotFoundException('Termin nicht gefunden');
    return {
      uid: event.uid,
      title: event.title,
      startDatetime: event.startDatetime,
      endDatetime: event.endDatetime,
      timezone: event.timezone,
      location: event.location,
      description: event.description,
      status: event.status,
      organizerEmail: event.organizerEmail,
      createdAt: event.createdAt,
      updatedAt: event.updatedAt,
      details: event.eventDetails ?? null,
    };
  }

  async updateByUid(uid: string, dto: UpdateEventDto) {
    const event = await this.prisma.event.findUnique({
      where: { uid },
      include: { eventDetails: true },
    });
    if (!event) throw new NotFoundException('Termin nicht gefunden');
    if (event.status === 'cancelled') throw new NotFoundException('Termin wurde bereits abgesagt');

    const newSequence = event.sequence + 1;

    // Update core event fields
    const eventUpdateData: any = { sequence: newSequence };
    if (dto.title !== undefined)         eventUpdateData.title = dto.title;
    if (dto.startDatetime !== undefined) eventUpdateData.startDatetime = new Date(dto.startDatetime);
    if (dto.endDatetime !== undefined)   eventUpdateData.endDatetime = new Date(dto.endDatetime);
    if (dto.timezone !== undefined)      eventUpdateData.timezone = dto.timezone;
    if (dto.location !== undefined)      eventUpdateData.location = dto.location;
    if (dto.description !== undefined)   eventUpdateData.description = dto.description;

    const updatedEvent = await this.prisma.event.update({
      where: { uid },
      data: eventUpdateData,
    });

    // Update EventDetail fields
    const detailFields: any = {};
    if (dto.notes !== undefined)               detailFields.notes = dto.notes;
    if (dto.bookingCode !== undefined)         detailFields.bookingCode = dto.bookingCode;
    if (dto.price !== undefined)               detailFields.price = dto.price;
    if (dto.checkIn !== undefined)             detailFields.checkIn = dto.checkIn;
    if (dto.checkOut !== undefined)            detailFields.checkOut = dto.checkOut;
    if (dto.flightNumber !== undefined)        detailFields.flightNumber = dto.flightNumber;
    if (dto.seat !== undefined)                detailFields.seat = dto.seat;
    if (dto.gate !== undefined)                detailFields.gate = dto.gate;
    if (dto.cancellationPolicy !== undefined)  detailFields.cancellationPolicy = dto.cancellationPolicy;
    if (dto.address !== undefined)             detailFields.address = dto.address;
    if (dto.contact !== undefined)             detailFields.contact = dto.contact;
    if (dto.accessCodes !== undefined)         detailFields.accessCodes = dto.accessCodes;
    if (dto.parking !== undefined)             detailFields.parking = dto.parking;
    if (dto.dietary !== undefined)             detailFields.dietary = dto.dietary;
    if (dto.agenda !== undefined)              detailFields.agenda = dto.agenda;
    if (dto.extra !== undefined)               detailFields.extra = dto.extra;

    let updatedDetails = event.eventDetails;
    if (Object.keys(detailFields).length > 0) {
      updatedDetails = await this.prisma.eventDetail.upsert({
        where: { eventId: event.id },
        update: detailFields,
        create: { eventId: event.id, ...detailFields },
      });
    }

    await this.prisma.auditLog.create({
      data: { eventId: event.id, action: 'event_updated_via_web', details: { dto } as any },
    });

    this.logger.log(`Updated event uid=${uid} sequence=${newSequence} via web`);

    // Regenerate ICS and send updated email
    const icsContent = this.ics.generate(updatedEvent, [], updatedDetails);
    const pdfBuffer = this.pdf.generate(updatedEvent, '', updatedDetails);

    await this.emailSend.sendEventEmail({
      to: event.organizerEmail,
      isUpdate: true,
      event: updatedEvent,
      icsContent,
      attachmentIds: [],
      eventDetails: updatedDetails,
      pdfBuffer,
      threadId: event.threadId ?? undefined,
    });

    return { success: true, sequence: newSequence };
  }

  async cancelByUid(uid: string) {
    const event = await this.prisma.event.findUnique({
      where: { uid },
      include: { eventDetails: true },
    });
    if (!event) throw new NotFoundException('Termin nicht gefunden');
    if (event.status === 'cancelled') return { success: true, already: true };

    const newSequence = event.sequence + 1;

    const cancelledEvent = await this.prisma.event.update({
      where: { uid },
      data: { status: 'cancelled', sequence: newSequence },
    });

    await this.prisma.auditLog.create({
      data: { eventId: event.id, action: 'event_cancelled_via_web', details: {} as any },
    });

    this.logger.log(`Cancelled event uid=${uid}`);

    // Send cancellation ICS (METHOD:CANCEL)
    const icsContent = this.ics.generate(cancelledEvent, [], event.eventDetails, 'CANCEL');

    await this.emailSend.sendEventEmail({
      to: event.organizerEmail,
      isUpdate: true,
      isCancellation: true,
      event: cancelledEvent,
      icsContent,
      attachmentIds: [],
      eventDetails: event.eventDetails,
      threadId: event.threadId ?? undefined,
    });

    return { success: true };
  }
}
