import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { DateTime } from 'luxon';

@Injectable()
export class PdfService {
  async generate(event: any, rawEmailBody: string, details: any): Promise<Buffer> {
    return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ margin: 50, size: 'A4' });

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const tz = event.timezone || 'Europe/Berlin';
    const startDt = DateTime.fromJSDate(new Date(event.startDatetime)).setZone(tz);
    const endDt = DateTime.fromJSDate(new Date(event.endDatetime)).setZone(tz);

    const sameDay = startDt.toISODate() === endDt.toISODate();
    const dateRange = sameDay
      ? `${startDt.toFormat('dd. LLLL yyyy')} · ${startDt.toFormat('HH:mm')}–${endDt.toFormat('HH:mm')} ${startDt.toFormat('ZZZZ')}`
      : `${startDt.toFormat('dd. LLLL yyyy')} – ${endDt.toFormat('dd. LLLL yyyy')}`;

    // ── Header bar ──────────────────────────────────────────────────
    doc.rect(0, 0, doc.page.width, 80).fill('#1a1a2e');
    doc.fillColor('white').fontSize(22).font('Helvetica-Bold')
      .text(event.title, 50, 25, { width: doc.page.width - 100 });
    doc.fillColor('#aaaacc').fontSize(11).font('Helvetica')
      .text(dateRange, 50, 55);

    doc.fillColor('#333333');
    let y = 105;

    // ── Key details table ────────────────────────────────────────────
    const rows: [string, string][] = [];

    if (event.location) rows.push(['📍 Ort', event.location]);
    if (details?.checkIn || details?.checkOut) {
      const ci = details.checkIn ? `Check-in: ${details.checkIn}` : '';
      const co = details.checkOut ? `Check-out: ${details.checkOut}` : '';
      rows.push(['⏰ Zeiten', [ci, co].filter(Boolean).join('   ·   ')]);
    }
    if (details?.bookingCode) rows.push(['🔖 Buchungscode', details.bookingCode]);
    if (details?.hotelName) rows.push(['🏨 Hotel / Anbieter', details.hotelName]);
    if (details?.address && details.address !== event.location) rows.push(['🗺 Adresse', details.address]);
    if (details?.price) rows.push(['💶 Preis', details.price]);
    if (details?.cancellationPolicy) rows.push(['⚠️ Stornierung', details.cancellationPolicy]);
    if (details?.accessCodes) rows.push(['🔑 Zugangscodes', details.accessCodes]);
    if (details?.parking) rows.push(['🚗 Parken', details.parking]);
    if (details?.dietary) rows.push(['🍽 Verpflegung', details.dietary]);
    if (details?.flightNumber) rows.push(['✈️ Flug / Verbindung', details.flightNumber]);
    if (details?.seat) rows.push(['💺 Sitz / Klasse', details.seat]);
    if (details?.gate) rows.push(['🚪 Gate / Gleis', details.gate]);
    if (details?.contact) rows.push(['📞 Kontakt', details.contact]);
    if (details?.organizer) rows.push(['👤 Organisator', details.organizer]);
    if (details?.dressCode) rows.push(['👔 Dress Code', details.dressCode]);
    if (details?.agenda) rows.push(['📋 Agenda', details.agenda]);
    if (details?.notes) rows.push(['📝 Hinweise', details.notes]);
    if (details?.extra) rows.push(['ℹ️ Weitere Infos', details.extra]);

    if (rows.length > 0) {
      const colW = 140;
      const rowH = 22;
      const pageW = doc.page.width - 100;

      for (let i = 0; i < rows.length; i++) {
        const [label, value] = rows[i];
        const bg = i % 2 === 0 ? '#f7f7fb' : '#ffffff';
        doc.rect(50, y, pageW, rowH).fill(bg);

        doc.fillColor('#555577').fontSize(9).font('Helvetica-Bold')
          .text(label, 58, y + 6, { width: colW - 10 });
        doc.fillColor('#222222').fontSize(9).font('Helvetica')
          .text(value, 58 + colW, y + 6, { width: pageW - colW - 10, lineBreak: false, ellipsis: true });

        y += rowH;
      }
      y += 16;
    }

    // ── Description ──────────────────────────────────────────────────
    if (event.description) {
      doc.moveTo(50, y).lineTo(doc.page.width - 50, y).stroke('#ddddee');
      y += 12;
      doc.fillColor('#1a1a2e').fontSize(11).font('Helvetica-Bold').text('Zusammenfassung', 50, y);
      y += 18;
      doc.fillColor('#333333').fontSize(9.5).font('Helvetica')
        .text(event.description, 50, y, { width: doc.page.width - 100, lineGap: 3 });
      y = doc.y + 16;
    }

    // ── Original email ────────────────────────────────────────────────
    if (rawEmailBody) {
      if (y > doc.page.height - 150) {
        doc.addPage();
        y = 50;
      }
      doc.moveTo(50, y).lineTo(doc.page.width - 50, y).stroke('#ddddee');
      y += 12;
      doc.fillColor('#1a1a2e').fontSize(11).font('Helvetica-Bold').text('Original-E-Mail', 50, y);
      y += 18;
      doc.fillColor('#555555').fontSize(8).font('Courier')
        .text(rawEmailBody.slice(0, 6000), 50, y, {
          width: doc.page.width - 100,
          lineGap: 1.5,
        });
    }

    // ── Footer ────────────────────────────────────────────────────────
    const footerY = doc.page.height - 35;
    doc.rect(0, footerY - 5, doc.page.width, 40).fill('#f0f0f8');
    doc.fillColor('#888888').fontSize(8).font('Helvetica')
      .text('Erstellt von Meetingbutler.de', 50, footerY, { align: 'center', width: doc.page.width - 100 });

    doc.end();
    }); // end Promise
  }
}
