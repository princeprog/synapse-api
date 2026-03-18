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

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  async register(@Body() createUserDto: CreateUserDto) {
    return this.authService.register(createUserDto);
  }

  @Post('login')
  async login(
    @Body() loginDto: { username: string; password: string },
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
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
  getProfile(@Request() req) {
    return req.user;
  }
}
