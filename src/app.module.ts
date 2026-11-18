import { Module } from '@nestjs/common';
import { ClientsModule } from './clients';
import { HealthController } from './health.controller';
import { MessagingModule } from './messaging/messaging.module';
import { SharedModule } from './shared/shared.module';

@Module({
  imports: [SharedModule, ClientsModule, MessagingModule],
  controllers: [HealthController],
})
export class AppModule {}
