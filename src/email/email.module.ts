import { Module } from '@nestjs/common';
import { EmailSendService } from './email-send.service';

@Module({
  providers: [EmailSendService],
  exports: [EmailSendService],
})
export class EmailModule {}
