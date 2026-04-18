import { Controller, Get, Param, NotFoundException, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { EventsService } from './events.service';
import { AdminApiKeyGuard } from '../admin/admin-api-key.guard';

@Controller('events')
@UseGuards(AdminApiKeyGuard)
export class EventsController {
  constructor(private eventsService: EventsService) {}

  @Get()
  findAll() {
    return this.eventsService.findAll();
  }

  @Get(':id')
  async findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    const event = await this.eventsService.findOne(id);
    if (!event) throw new NotFoundException('Not found');
    return event;
  }
}
