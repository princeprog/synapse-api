import {
  Controller,
  Post,
  Body,
  Request,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CreateUserDto } from '../users/dto/create-user.dto';
import '@fastify/cookie';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ApiBody, ApiOperation } from '@nestjs/swagger';
import { LoginDto } from './dto/login.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  async register(@Body() createUserDto: CreateUserDto) {
    return this.authService.register(createUserDto);
  }

  @Post('login')
  @ApiOperation({
    summary: 'User login',
    description: 'Authenticates a user and returns access and refresh tokens.',
  })
  @ApiBody({
    type: LoginDto,
    description: 'The username and password of the user to log in',
  })
  async login(
    @Body() loginDto: LoginDto,
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const user = await this.authService.validateUser(
      loginDto.username,
      loginDto.password,
    );
    return this.authService.login(user, response);
  }

  @Post('logout')
  async logout(
    @Request() req: FastifyRequest,
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    return this.authService.logout(req.cookies['refresh-token'], response);
  }

  @Post('refresh')
  async refresh(
    @Request() req: FastifyRequest,
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    return this.authService.refresh(req.cookies['refresh-token'], response);
  }

  @Post('profile')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Get user profile',
    description: 'Retrieves the profile information of the authenticated user.',
  })
  getProfile(@Request() req) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access
    return req.user;
  }
}
