import { forwardRef, Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { AuthModule } from '../auth/auth.module';
import { MyProfileController } from './my-profile.controller';

@Module({
  imports: [forwardRef(() => AuthModule)],
  controllers: [UsersController, MyProfileController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
