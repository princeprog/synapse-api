import { Controller, Get, Request, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UsersService } from './users.service';

@Controller('my')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@ApiTags('users')
export class MyProfileController {
  constructor(private readonly usersService: UsersService) {}

  @Get('profile')
  @ApiOperation({
    summary: 'Get my user profile',
    description: 'Retrieves profile information for the authenticated user.',
  })
  @ApiResponse({
    status: 200,
    description: 'The user profile has been successfully retrieved.',
  })
  @ApiResponse({ status: 404, description: 'The user profile was not found.' })
  getProfile(@Request() req: { user: { userId: string } }) {
    return this.usersService.getProfileByUserId(req.user.userId);
  }
}
