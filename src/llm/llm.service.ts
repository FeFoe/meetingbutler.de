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
  important_details?: {
    booking_code?: string;
    hotel_name?: string;
    address?: string;
    notes?: string;
    access_codes?: string;
  };
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
    const prompt = `You are a calendar assistant. Extract event information from the forwarded email below.
Return ONLY valid JSON matching the schema. No markdown, no explanation.

Current date/time: ${now.toISO()}
Default timezone: Europe/Berlin

Email Subject: ${subject}
Email Body:
${bodyText.slice(0, 6000)}

Return JSON:
{
  "title": "clean event title",
  "start_datetime": "ISO 8601 with offset e.g. 2024-06-15T14:00:00+02:00",
  "end_datetime": "ISO 8601, infer +1h if missing",
  "timezone": "IANA timezone e.g. Europe/Berlin",
  "location": "full location or empty string",
  "description": "brief summary of the event",
  "participants": ["email or name"],
  "important_details": {
    "booking_code": "booking/reservation/confirmation code if found",
    "hotel_name": "hotel or venue name if applicable",
    "address": "full address if found",
    "notes": "any important notes, check-in info, special instructions",
    "access_codes": "PINs, access codes, wifi passwords, door codes"
  },
  "confidence": 0.95,
  "event_type": "meeting|travel|hotel|flight|conference|dinner|other"
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
        this.logger.error('LLM returned empty response');
        return null;
      }

      const extracted: ExtractedEvent = JSON.parse(content);

      // Validate required fields
      if (!extracted.title || !extracted.start_datetime) {
        this.logger.error('LLM response missing required fields');
        return null;
      }

      // Ensure end_datetime
      if (!extracted.end_datetime) {
        const start = DateTime.fromISO(extracted.start_datetime);
        extracted.end_datetime = start.plus({ hours: 1 }).toISO();
      }

      // Ensure timezone
      if (!extracted.timezone) {
        extracted.timezone = 'Europe/Berlin';
      }

      this.logger.log(`LLM extracted: "${extracted.title}" (${extracted.event_type}) confidence=${extracted.confidence}`);
      return extracted;
    } catch (err) {
      this.logger.error(`LLM extraction failed: ${err.message}`, err.stack);
      return null;
    }
  }

  async parseUpdate(existingEvent: any, instruction: string): Promise<UpdateDiff | null> {
    const now = DateTime.now().setZone('Europe/Berlin');
    const prompt = `You are a calendar assistant. Apply the user's natural language update instruction to the existing event.
Return ONLY valid JSON with only the fields that need to be changed. No markdown, no explanation.

Current date/time: ${now.toISO()}

Existing event:
- Title: ${existingEvent.title}
- Start: ${existingEvent.startDatetime}
- End: ${existingEvent.endDatetime}
- Timezone: ${existingEvent.timezone}
- Location: ${existingEvent.location || 'none'}
- Description: ${existingEvent.description || 'none'}

Update instruction from user:
"${instruction.slice(0, 2000)}"

Return JSON with ONLY the fields to change (omit unchanged fields):
{
  "title": "new title if changed",
  "start_datetime": "ISO 8601 if changed",
  "end_datetime": "ISO 8601 if changed",
  "timezone": "IANA if changed",
  "location": "new location if changed",
  "description": "new description if changed",
  "important_details": {
    "notes": "additional notes if provided"
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
      this.logger.log(`LLM update diff: ${JSON.stringify(diff)}`);
      return diff;
    } catch (err) {
      this.logger.error(`LLM update parsing failed: ${err.message}`, err.stack);
      return null;
    }
  }
}
