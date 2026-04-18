import { Controller, Get, Param, NotFoundException, ParseUUIDPipe } from '@nestjs/common';
import { EventsService } from './events.service';

@Controller('events')
export class EventsController {
  constructor(private eventsService: EventsService) {}

  @Get()
  findAll() {
    return this.eventsService.findAll();
  }

  @Get(':id')
  async findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    const event = await this.eventsService.findOne(id);
    if (!event) throw new NotFoundException(`Event ${id} not found`);
    return event;
  }
}
