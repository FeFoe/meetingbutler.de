# Design: Beschreibungsfeld vereinfachen + Admin Dashboard

**Datum:** 2026-04-18

---

## Feature 1: Einheitliches Beschreibungsfeld in der Manage-Seite

### Problem
Die Manage-Seite (`termin.html`) zeigt aktuell alle `EventDetail`-Felder einzeln (Buchungscode, Hotel, Flugnummer, Sitz, Gate, Preis, …). Das ist für Nutzer überwältigend.

### Lösung
Die ~15 EventDetail-Felder im Formular werden durch **ein einziges `<textarea>` für `description`** ersetzt. Strukturierte Felder (Titel, Datum/Uhrzeit, Ort) bleiben als eigene Inputs erhalten.

### Änderungen

**`public/termin.html`**
- Entferne alle EventDetail-Felder aus dem Formular
- Füge ein großes `<textarea id="description">` hinzu, vorausgefüllt mit `event.description`
- Der PATCH-Request schickt nur noch `{ description, title, startDatetime, endDatetime, location }`

**`src/llm/llm.service.ts`**
- Das LLM-Prompt wird angepasst: `description` soll alle wichtigen Details als lesbaren Fließtext enthalten (Buchungscode, Hotel, Gate usw. als formatierter Text, nicht als separate JSON-Felder)
- `important_details` bleibt im Schema, wird aber nicht mehr aktiv vom LLM befüllt

**`src/events/event-match.processor.ts`**
- `event.description` wird mit dem LLM-Freitext gespeichert (kein `eventDetails`-Upsert mehr nötig für neue Events)

**Backend unverändert:** `UpdateEventDto.description`, `EventsService.updateByUid`, ICS-Regenerierung und Update-Mail existieren bereits und funktionieren.

### Flow
1. Nutzer öffnet Manage-Link aus der ICS-Mail
2. Sieht: Titel, Datum, Uhrzeit, Ort (als Felder) + Beschreibung (als Textarea)
3. Bearbeitet Beschreibungstext → klickt "Termin aktualisieren"
4. Backend: `event.description` + `event.sequence + 1` → neue ICS → Update-Mail

---

## Feature 2: Admin Dashboard

### Lösung
Neue statische HTML-Seite `/admin-dashboard.html` + neuer API-Endpoint `/api/admin/stats`.

### Passwortschutz
- Env-Variable `ADMIN_DASHBOARD_PASSWORD` (in `.env`)
- HTML-Seite zeigt beim Laden ein Passwort-Eingabefeld
- Das Passwort wird als Query-Parameter `?password=...` an `/api/admin/stats` mitgegeben
- Der Endpoint prüft: `password === ADMIN_DASHBOARD_PASSWORD`, sonst 401

### Datenbankänderung
Neues Feld auf `Event`:
```prisma
tokensUsed Int @default(0)
```
Prisma-Migration erforderlich.

### Token-Tracking
- `llm.service.ts`: `extractEvent()` gibt zusätzlich `tokensUsed: number` zurück (`response.usage.total_tokens`)
- `event-match.processor.ts`: speichert `tokensUsed` beim `event.create()`

### API: `GET /api/admin/stats?password=...`
Response:
```json
{
  "summary": {
    "totalUsers": 42,
    "totalEvents": 187,
    "totalTokens": 94200,
    "estimatedCostEur": 0.28
  },
  "users": [
    {
      "firstName": "Felix",
      "lastName": "F.",
      "email": "felix@...",
      "eventCount": 12,
      "tokensUsed": 6400
    }
  ]
}
```
Kosten-Berechnung: `totalTokens * 0.000003` (gpt-5.4-nano Input-Preis, hardcoded).

### HTML-Seite `public/admin-dashboard.html`
- Passwort-Eingabe → Fetch auf `/api/admin/stats?password=...`
- Zusammenfassungszeile oben: Nutzer / Events / Tokens / Kosten
- Tabelle: Name | E-Mail | Events | Tokens
- Gleiches Design wie `index.html` (Outfit-Font, Navy/Blue)

---

## Scope nicht enthalten
- Zeitreihen / Charts
- EventDetail-Modell löschen (Spalten bleiben, werden nur nicht mehr befüllt)
- Passwort-Hashing (Plain-Text-Vergleich reicht für internes Admin-Tool)
