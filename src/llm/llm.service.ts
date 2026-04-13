import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { DateTime } from 'luxon';

export interface ExtractedEvent {
  title: string;
  start_datetime: string;
  end_datetime: string;
  timezone: string;
  location: string;
  description: string;
  participants: string[];
  important_details: {
    booking_code: string;
    hotel_name: string;
    address: string;
    notes: string;
    access_codes: string;
    price: string;
    cancellation_policy: string;
    contact: string;
    dress_code: string;
    parking: string;
    dietary: string;
    check_in: string;
    check_out: string;
    flight_number: string;
    seat: string;
    gate: string;
    organizer: string;
    agenda: string;
    extra: string;
  };
  confidence: number;
  event_type: string;
}

export interface UpdateDiff {
  title?: string;
  start_datetime?: string;
  end_datetime?: string;
  timezone?: string;
  location?: string;
  description?: string;
  important_details?: Partial<ExtractedEvent['important_details']>;
}

const MODEL = 'gpt-5.4-nano';

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private client: OpenAI;

  constructor(private config: ConfigService) {
    this.client = new OpenAI({ apiKey: config.get<string>('OPENAI_KEY') });
  }

  async extractEvent(subject: string, bodyText: string): Promise<ExtractedEvent | null> {
    const now = DateTime.now().setZone('Europe/Berlin');
    const prompt = `You are an expert calendar assistant. Extract ALL relevant event information from the forwarded email below. Be thorough: capture every useful detail from the email and make reasonable inferences from context where information is implicit.

Return ONLY valid JSON. No markdown, no explanation.

Current date/time: ${now.toISO()}
Default timezone: Europe/Berlin

Email Subject: ${subject}
Email Body:
${bodyText.slice(0, 8000)}

INSTRUCTIONS:
- "title": Short, clean, human-friendly event title. Include hotel/venue/company name if relevant.
- "description": Write a COMPREHENSIVE, well-structured plain-text description. Include: what this event is, all relevant facts from the email, inferred context (e.g. for hotels: typical check-in procedure, what to bring), important numbers, any action items. This should be the single source of truth someone needs to attend or prepare for the event. Use clear sections separated by newlines. Be generous — include everything useful.
- "start_datetime" / "end_datetime": ISO 8601 with timezone offset. Infer end as +1h if truly unknown (for hotel stays infer check-out date if present).
- "timezone": IANA (e.g. Europe/Berlin). Infer from location/country if not explicit.
- "location": Full address or venue name and city. Include country if international.
- "participants": Email addresses or names mentioned as attendees, guests, or recipients.
- "important_details": Extract every structured field you can find. Leave as empty string "" if not found — do NOT omit fields.
  - "booking_code": Any booking/reservation/confirmation/ticket/order number
  - "hotel_name": Hotel, venue, or place name
  - "address": Complete postal address
  - "notes": Check-in instructions, special conditions, what to bring, important reminders
  - "access_codes": PINs, wifi passwords, door codes, locker codes
  - "price": Total price or nightly rate with currency
  - "cancellation_policy": Cancellation deadline and terms
  - "contact": Phone number, email, or contact person at the venue
  - "dress_code": If mentioned or inferable (e.g. business formal for board meeting)
  - "parking": Parking info, parking codes, cost
  - "dietary": Dietary options, meal info, breakfast included etc.
  - "check_in": Check-in time or procedure
  - "check_out": Check-out time or procedure
  - "flight_number": Flight/train number if applicable
  - "seat": Seat number if applicable
  - "gate": Gate or platform if applicable
  - "organizer": Name or company of event organizer
  - "agenda": Meeting agenda or schedule if present
  - "extra": Any other important information not captured elsewhere
- "event_type": One of: meeting|hotel|flight|train|conference|dinner|concert|sport|travel|appointment|other
- "confidence": 0.0–1.0

Return JSON:
{
  "title": "...",
  "start_datetime": "...",
  "end_datetime": "...",
  "timezone": "...",
  "location": "...",
  "description": "...",
  "participants": [],
  "important_details": {
    "booking_code": "",
    "hotel_name": "",
    "address": "",
    "notes": "",
    "access_codes": "",
    "price": "",
    "cancellation_policy": "",
    "contact": "",
    "dress_code": "",
    "parking": "",
    "dietary": "",
    "check_in": "",
    "check_out": "",
    "flight_number": "",
    "seat": "",
    "gate": "",
    "organizer": "",
    "agenda": "",
    "extra": ""
  },
  "confidence": 0.0,
  "event_type": "..."
}`;

    try {
      const response = await this.client.chat.completions.create({
        model: MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        response_format: { type: 'json_object' },
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        this.logger.error('LLM returned empty response');
        return null;
      }

      const extracted: ExtractedEvent = JSON.parse(content);

      if (!extracted.title || !extracted.start_datetime) {
        this.logger.error('LLM response missing required fields');
        return null;
      }

      if (!extracted.end_datetime) {
        const start = DateTime.fromISO(extracted.start_datetime);
        extracted.end_datetime = start.plus({ hours: 1 }).toISO();
      }

      if (!extracted.timezone) {
        extracted.timezone = 'Europe/Berlin';
      }

      // Ensure important_details exists with all fields
      extracted.important_details = {
        booking_code: '',
        hotel_name: '',
        address: '',
        notes: '',
        access_codes: '',
        price: '',
        cancellation_policy: '',
        contact: '',
        dress_code: '',
        parking: '',
        dietary: '',
        check_in: '',
        check_out: '',
        flight_number: '',
        seat: '',
        gate: '',
        organizer: '',
        agenda: '',
        extra: '',
        ...(extracted.important_details || {}),
      };

      this.logger.log(`LLM extracted: "${extracted.title}" (${extracted.event_type}) confidence=${extracted.confidence}`);
      return extracted;
    } catch (err) {
      this.logger.error(`LLM extraction failed: ${err.message}`, err.stack);
      return null;
    }
  }

  async parseUpdate(existingEvent: any, instruction: string): Promise<UpdateDiff | null> {
    const now = DateTime.now().setZone('Europe/Berlin');

    // Load existing event details for context
    const detailsContext = existingEvent.eventDetails
      ? `- Booking code: ${existingEvent.eventDetails.bookingCode || 'none'}
- Notes: ${existingEvent.eventDetails.notes || 'none'}
- Access codes: ${existingEvent.eventDetails.accessCodes || 'none'}`
      : '';

    const prompt = `You are a calendar assistant. Apply the user's natural language update instruction to the existing event.
Return ONLY valid JSON with ONLY the fields that need to change. Omit all unchanged fields.

Current date/time: ${now.toISO()}

Existing event:
- Title: ${existingEvent.title}
- Start: ${existingEvent.startDatetime}
- End: ${existingEvent.endDatetime}
- Timezone: ${existingEvent.timezone}
- Location: ${existingEvent.location || 'none'}
- Description: ${(existingEvent.description || '').slice(0, 500)}
${detailsContext}

User instruction:
"${instruction.slice(0, 3000)}"

Rules:
- For time changes like "move to 15:00 tomorrow": compute the new absolute ISO datetime based on current date/time above.
- For "add note: X": append to important_details.notes, do not replace existing notes.
- For location changes: update location field.
- For title changes: update title field.
- Update description only if the meaning changes significantly.

Return ONLY changed fields as JSON:
{
  "title": "...",
  "start_datetime": "ISO 8601",
  "end_datetime": "ISO 8601",
  "timezone": "IANA",
  "location": "...",
  "description": "...",
  "important_details": {
    "notes": "...",
    "booking_code": "...",
    "access_codes": "...",
    "extra": "..."
  }
}`;

    try {
      const response = await this.client.chat.completions.create({
        model: MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        response_format: { type: 'json_object' },
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        this.logger.error('LLM update returned empty response');
        return null;
      }

      const diff: UpdateDiff = JSON.parse(content);
      this.logger.log(`LLM update diff keys: ${Object.keys(diff).join(', ')}`);
      return diff;
    } catch (err) {
      this.logger.error(`LLM update parsing failed: ${err.message}`, err.stack);
      return null;
    }
  }
}
