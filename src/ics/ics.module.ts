import { Module } from '@nestjs/common';
import { IcsService } from './ics.service';

@Module({
  providers: [IcsService],
  exports: [IcsService],
})
export class IcsModule {}
