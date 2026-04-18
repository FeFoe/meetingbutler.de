import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminApiKeyGuard } from './admin-api-key.guard';

@Module({
  controllers: [AdminController],
  providers: [AdminApiKeyGuard],
})
export class AdminModule {}
