import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { MessagesController } from './messages.controller';
import { MessagesGateway } from './messages.gateway';
import { MessagesService } from './messages.service';

@Module({
  imports: [AuthModule, NotificationsModule],
  controllers: [MessagesController],
  providers: [MessagesGateway, MessagesService],
})
export class MessagesModule {}
