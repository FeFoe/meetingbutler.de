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

export interface ExtractResult {
  event: ExtractedEvent;
  tokensUsed: number;
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

  async extractEvent(subject: string, bodyText: string): Promise<ExtractResult | null> {
    const now = DateTime.now().setZone('Europe/Berlin');
    const prompt = `You are an expert personal assistant and calendar manager. A user has forwarded an email to you. Your job is to:
1. Extract every factual detail from the email
2. Enrich the event with context-aware inferences — things someone would need to know even if not explicitly stated

Return ONLY valid JSON. No markdown, no explanation.

Current date/time: ${now.toISO()}
Default timezone: Europe/Berlin

Email Subject: ${subject}
Email Body:
${bodyText.slice(0, 8000)}

═══════════════════════════════════════
FIELD INSTRUCTIONS
═══════════════════════════════════════

"title"
  Short, human-friendly name. Include the venue/company/flight. Examples:
  "Hotel Stay – Marriott Berlin", "Flight LH441 Munich→London", "Team Kickoff – Acme GmbH"

"description"
  Write a SHORT, scannable summary using emojis. Maximum 8-10 lines.
  Only include the most important facts a person needs at a glance.
  Use this format (include only relevant lines for the event type):

  📍 [Venue / Location full address]
  🗓 [Date range, e.g. "23.–26. April 2026"]
  ⏰ [Check-in: HH:MM · Check-out: HH:MM]  OR  [Departure: HH:MM · Arrival: HH:MM]
  🛏 [Room type / Seat / Class]
  🔖 [Booking code / Confirmation number / Ticket number]
  💶 [Total price with currency and what's included, e.g. "EUR 345 inkl. Frühstück"]
  🚗 [Parking info if relevant]
  📶 [WiFi / Access codes if present]
  📞 [Contact phone / email]
  ⚠️ [Cancellation deadline or one critical note, if present]

  DO NOT include obvious or generic statements. No full sentences. No headers. No bullet dashes.
  Only facts from the email. Skip lines that have no data.

"start_datetime"
  ISO 8601 with timezone offset. Use the event start (check-in time for hotels, departure for flights).

"end_datetime"
  ISO 8601. Use actual end if found (check-out for hotels, arrival for flights). Infer +1h only if completely unknown.

"timezone"
  IANA timezone. Infer from country/city in the email.

"location"
  Full address or venue + city + country. Always include country for international events.

"participants"
  Email addresses or full names explicitly mentioned as attendees, guests, or co-travelers.

"important_details"
  Extract each field carefully. If not found in the email, infer a reasonable value based on event type, or leave "".
  - "booking_code": ALL booking/reservation/ticket/order/confirmation numbers (list all if multiple)
  - "hotel_name": Hotel, venue, airline, or service provider name
  - "address": Complete postal address including street, city, postcode, country
  - "notes": Compiled key notes — check-in procedure, what to bring, important conditions
  - "access_codes": ALL codes found — wifi password, parking code, PIN, locker, door code
  - "price": Total amount with currency. Include nightly rate if relevant.
  - "cancellation_policy": Exact cancellation deadline and penalty terms from the email
  - "contact": Phone, email, or contact person name at the venue/company
  - "dress_code": From email or inferred (e.g. "Business casual" for corporate dinner)
  - "parking": Parking location, code, cost, instructions
  - "dietary": Meals included, dietary options, meal times, restaurant info
  - "check_in": Check-in time and any early/late check-in procedure
  - "check_out": Check-out time and late check-out procedure
  - "flight_number": Flight/train/bus number
  - "seat": Seat or cabin number/class
  - "gate": Gate, terminal, or platform
  - "organizer": Full name and company of event organizer or booking party
  - "agenda": Meeting agenda, conference schedule, or itinerary from the email
  - "extra": All remaining useful info not captured above (loyalty numbers, special requests, etc.)

"event_type"
  One of: meeting | hotel | flight | train | conference | dinner | concert | sport | travel | appointment | other

"confidence"
  0.0–1.0 reflecting how certain you are about the datetime and key details

Return JSON with all fields populated:
{
  "title": "...",
  "start_datetime": "2026-01-01T15:00:00+01:00",
  "end_datetime": "2026-01-04T11:00:00+01:00",
  "timezone": "Europe/Berlin",
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
  "confidence": 0.9,
  "event_type": "hotel"
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

      const tokensUsed = response.usage?.total_tokens ?? 0;
      this.logger.log(`LLM extracted: "${extracted.title}" (${extracted.event_type}) confidence=${extracted.confidence} tokens=${tokensUsed}`);
      return { event: extracted, tokensUsed };
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
