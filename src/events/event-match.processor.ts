import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue, Job } from 'bull';
import { PrismaService } from '../common/prisma.service';
import { LlmService } from '../llm/llm.service';
import { IcsService } from '../ics/ics.service';
import { EmailSendService } from '../email/email-send.service';
import { PdfService } from '../pdf/pdf.service';
import {
  QUEUE_EVENT_MATCH,
  QUEUE_LLM_EXTRACT,
  QUEUE_ICS_GENERATE,
  QUEUE_EMAIL_SEND,
} from '../queue/queue.module';
import { v4 as uuidv4 } from 'uuid';

@Processor(QUEUE_EVENT_MATCH)
export class EventMatchProcessor {
  private readonly logger = new Logger(EventMatchProcessor.name);

  constructor(
    private prisma: PrismaService,
    private llm: LlmService,
    private ics: IcsService,
    private emailSend: EmailSendService,
    private pdf: PdfService,
    @InjectQueue(QUEUE_EVENT_MATCH) private matchQueue: Queue,
  ) {}

  /** Returns true for decorative images (logos, banners, icons) that should not be attached. */
  private isDecorativeAttachment(filename: string, contentType: string, size: number): boolean {
    if (!contentType.startsWith('image/')) return false;
    const name = (filename || '').toLowerCase();
    // Small images are almost always decorative
    if (size < 30_000) return true;
    // Common logo/decoration name patterns
    if (/logo|banner|header|footer|signature|icon|spacer|bg|background|decoration/.test(name)) return true;
    return false;
  }

  @Process('match-or-create')
  async handle(
    job: Job<{
      rawEmailId: string;
      messageId: string;
      inReplyTo: string | null;
      references: string | null;
      fromAddress: string;
      subject: string;
      bodyText: string;
      attachmentIds: string[];
    }>,
  ) {
    const { rawEmailId, messageId, inReplyTo, references, fromAddress, subject, bodyText, attachmentIds } = job.data;

    this.logger.log(`Event match for rawEmailId=${rawEmailId}`);

    // Determine if this is an update reply
    const existingEvent = await this.findLinkedEvent(inReplyTo, references);

    if (existingEvent) {
      this.logger.log(`Detected reply to existing event id=${existingEvent.id}, applying update`);
      await this.applyUpdate(existingEvent, bodyText, rawEmailId, messageId, attachmentIds, fromAddress);
    } else {
      this.logger.log('No existing event found, creating new event');
      await this.createNewEvent(rawEmailId, messageId, fromAddress, subject, bodyText, attachmentIds);
    }
  }

  private async findLinkedEvent(inReplyTo: string | null, references: string | null) {
    if (!inReplyTo && !references) return null;

    // Check thread by In-Reply-To
    if (inReplyTo) {
      const thread = await this.prisma.emailThread.findFirst({
        where: { latestMessageId: inReplyTo },
        include: { events: { orderBy: { createdAt: 'desc' }, take: 1 } },
      });
      if (thread?.events?.length > 0) return thread.events[0];

      // Also check raw_emails for the In-Reply-To message
      const referencedEmail = await this.prisma.rawEmail.findUnique({
        where: { messageId: inReplyTo },
      });
      if (referencedEmail) {
        const event = await this.prisma.event.findFirst({
          where: { sourceEmailId: referencedEmail.id },
          orderBy: { createdAt: 'desc' },
        });
        if (event) return event;
      }
    }

    // Check references chain
    if (references) {
      const refIds = references.split(/\s+/).filter(Boolean);
      for (const refId of refIds.reverse()) {
        const referencedEmail = await this.prisma.rawEmail.findUnique({ where: { messageId: refId } });
        if (referencedEmail) {
          const event = await this.prisma.event.findFirst({
            where: { sourceEmailId: referencedEmail.id },
            orderBy: { createdAt: 'desc' },
          });
          if (event) return event;
        }
      }
    }

    return null;
  }

  private async createNewEvent(
    rawEmailId: string,
    messageId: string,
    fromAddress: string,
    subject: string,
    bodyText: string,
    attachmentIds: string[],
  ) {
    // Extract event data via LLM
    const extracted = await this.llm.extractEvent(subject, bodyText);
    if (!extracted) {
      this.logger.warn(`LLM extraction failed for email ${rawEmailId}`);
      return;
    }

    const uid = uuidv4();

    // Create or get thread
    const thread = await this.prisma.emailThread.create({
      data: {
        normalizedThreadKey: messageId,
        latestMessageId: messageId,
      },
    });

    // Create event
    const event = await this.prisma.event.create({
      data: {
        uid,
        sequence: 0,
        title: extracted.title,
        startDatetime: new Date(extracted.start_datetime),
        endDatetime: new Date(extracted.end_datetime),
        timezone: extracted.timezone || 'Europe/Berlin',
        location: extracted.location || null,
        description: extracted.description || null,
        organizerEmail: fromAddress,
        sourceEmailId: rawEmailId,
        threadId: thread.id,
        status: 'active',
      },
    });

    // Update thread with event
    await this.prisma.emailThread.update({
      where: { id: thread.id },
      data: { linkedEventId: event.id },
    });

    // Store event details
    const d = extracted.important_details || ({} as any);
    await this.prisma.eventDetail.create({
      data: {
        eventId: event.id,
        bookingCode: d.booking_code || null,
        hotelName: d.hotel_name || null,
        address: d.address || null,
        notes: d.notes || null,
        accessCodes: d.access_codes || null,
        price: d.price || null,
        cancellationPolicy: d.cancellation_policy || null,
        contact: d.contact || null,
        dressCode: d.dress_code || null,
        parking: d.parking || null,
        dietary: d.dietary || null,
        checkIn: d.check_in || null,
        checkOut: d.check_out || null,
        flightNumber: d.flight_number || null,
        seat: d.seat || null,
        gate: d.gate || null,
        organizer: d.organizer || null,
        agenda: d.agenda || null,
        extra: d.extra || null,
        rawJson: extracted as any,
      },
    });

    // Associate attachments with event
    if (attachmentIds.length > 0) {
      await this.prisma.attachment.updateMany({
        where: { id: { in: attachmentIds } },
        data: { eventId: event.id },
      });
    }

    // Audit log
    await this.prisma.auditLog.create({
      data: {
        eventId: event.id,
        action: 'event_created',
        details: { rawEmailId, extracted } as any,
      },
    });

    this.logger.log(`Created event id=${event.id} uid=${uid} title="${event.title}"`);

    // Load stored details for ICS and email enrichment
    const storedDetails = await this.prisma.eventDetail.findUnique({ where: { eventId: event.id } });

    // Filter out decorative image attachments
    const relevantAttachmentIds = await this.filterAttachments(attachmentIds);

    // Generate PDF summary
    const pdfBuffer = this.pdf.generate(event, bodyText, storedDetails);

    // Generate ICS
    const icsContent = this.ics.generate(event, extracted.participants || [], storedDetails);

    // Send reply email
    await this.emailSend.sendEventEmail({
      to: fromAddress,
      isUpdate: false,
      event,
      icsContent,
      attachmentIds: relevantAttachmentIds,
      eventDetails: storedDetails,
      pdfBuffer,
    });

    this.logger.log(`Sent new event email to ${fromAddress}`);
  }

  private async applyUpdate(
    existingEvent: any,
    instruction: string,
    rawEmailId: string,
    messageId: string,
    attachmentIds: string[],
    fromAddress: string,
  ) {
    // Parse update instruction via LLM
    const updated = await this.llm.parseUpdate(existingEvent, instruction);
    if (!updated) {
      this.logger.warn(`LLM update parsing failed for event ${existingEvent.id}`);
      return;
    }

    const newSequence = existingEvent.sequence + 1;

    // Apply updates
    const updatedEvent = await this.prisma.event.update({
      where: { id: existingEvent.id },
      data: {
        title: updated.title ?? existingEvent.title,
        startDatetime: updated.start_datetime ? new Date(updated.start_datetime) : existingEvent.startDatetime,
        endDatetime: updated.end_datetime ? new Date(updated.end_datetime) : existingEvent.endDatetime,
        timezone: updated.timezone ?? existingEvent.timezone,
        location: updated.location !== undefined ? updated.location : existingEvent.location,
        description: updated.description !== undefined ? updated.description : existingEvent.description,
        sequence: newSequence,
      },
    });

    // Update thread
    if (existingEvent.threadId) {
      await this.prisma.emailThread.update({
        where: { id: existingEvent.threadId },
        data: { latestMessageId: messageId },
      });
    }

    // Update event details if provided
    if (updated.important_details) {
      const ud = updated.important_details as any;
      const detailFields = {
        notes: ud.notes ?? undefined,
        bookingCode: ud.booking_code ?? undefined,
        hotelName: ud.hotel_name ?? undefined,
        address: ud.address ?? undefined,
        accessCodes: ud.access_codes ?? undefined,
        price: ud.price ?? undefined,
        cancellationPolicy: ud.cancellation_policy ?? undefined,
        contact: ud.contact ?? undefined,
        parking: ud.parking ?? undefined,
        dietary: ud.dietary ?? undefined,
        checkIn: ud.check_in ?? undefined,
        checkOut: ud.check_out ?? undefined,
        organizer: ud.organizer ?? undefined,
        agenda: ud.agenda ?? undefined,
        extra: ud.extra ?? undefined,
      };
      // Remove undefined keys
      const updateFields = Object.fromEntries(Object.entries(detailFields).filter(([, v]) => v !== undefined));
      await this.prisma.eventDetail.upsert({
        where: { eventId: existingEvent.id },
        update: updateFields,
        create: { eventId: existingEvent.id, ...updateFields },
      });
    }

    // Audit log
    await this.prisma.auditLog.create({
      data: {
        eventId: existingEvent.id,
        action: 'event_updated',
        details: { rawEmailId, instruction, updated, newSequence } as any,
      },
    });

    this.logger.log(`Updated event id=${existingEvent.id} sequence=${newSequence}`);

    // Load existing attachments for the event (filtered)
    const existingAttachments = await this.prisma.attachment.findMany({
      where: { eventId: existingEvent.id },
    });
    const allAttachmentIds = [
      ...existingAttachments.map((a) => a.id),
      ...attachmentIds,
    ];
    const relevantAttachmentIds = await this.filterAttachments(allAttachmentIds);

    // Load updated details for ICS enrichment
    const updatedDetails = await this.prisma.eventDetail.findUnique({ where: { eventId: existingEvent.id } });

    // Generate PDF summary
    const pdfBuffer = this.pdf.generate(updatedEvent, instruction, updatedDetails);

    // Generate ICS
    const icsContent = this.ics.generate(updatedEvent, [], updatedDetails);

    // Send updated invite
    await this.emailSend.sendEventEmail({
      to: fromAddress,
      isUpdate: true,
      event: updatedEvent,
      icsContent,
      attachmentIds: relevantAttachmentIds,
      eventDetails: updatedDetails,
      pdfBuffer,
    });

    this.logger.log(`Sent update email to ${fromAddress}`);
  }

  private async filterAttachments(attachmentIds: string[]): Promise<string[]> {
    if (!attachmentIds.length) return [];
    const attachments = await this.prisma.attachment.findMany({
      where: { id: { in: attachmentIds } },
    });
    return attachments
      .filter((a) => !this.isDecorativeAttachment(a.filename, a.contentType, a.size))
      .map((a) => a.id);
  }
}
