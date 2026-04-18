export class UpdateEventDto {
  title?: string;
  startDatetime?: string;
  endDatetime?: string;
  timezone?: string;
  location?: string;
  description?: string;
  // EventDetail fields
  notes?: string;
  bookingCode?: string;
  price?: string;
  checkIn?: string;
  checkOut?: string;
  flightNumber?: string;
  seat?: string;
  gate?: string;
  cancellationPolicy?: string;
  address?: string;
  contact?: string;
  accessCodes?: string;
  parking?: string;
  dietary?: string;
  agenda?: string;
  extra?: string;
}
