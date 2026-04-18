import { Controller, Get, Patch, Post, Param, Body, HttpCode } from '@nestjs/common';
import { EventsService } from './events.service';
import { UpdateEventDto } from './dto/update-event.dto';

/** Public management endpoints — secured by UUID (unguessable token). */
@Controller('events/manage')
export class ManageController {
  constructor(private eventsService: EventsService) {}

  @Get(':uid')
  findByUid(@Param('uid') uid: string) {
    return this.eventsService.findByUid(uid);
  }

  @Patch(':uid')
  updateByUid(@Param('uid') uid: string, @Body() dto: UpdateEventDto) {
    return this.eventsService.updateByUid(uid, dto);
  }

  @Post(':uid/cancel')
  @HttpCode(200)
  cancelByUid(@Param('uid') uid: string) {
    return this.eventsService.cancelByUid(uid);
  }
}
