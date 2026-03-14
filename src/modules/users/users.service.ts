import { Injectable, Inject } from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { DB } from 'src/database/database.types';
import { Kysely } from 'kysely';

@Injectable()
export class UsersService {
  constructor(@Inject("KYSELY_DB") private readonly db: Kysely<DB>) {}

  create(createUserDto: CreateUserDto) {
    return 'This action adds a new user';
  }

  findAll() {
    return `This action returns all users`;
  }

  async findOne(username: string) {
    const user = await this.db
    .selectFrom('auth.users')
    .selectAll()
    .where('username', '=', username)
    .executeTakeFirst();

    if(!user) {
      throw new Error('User not found');
    }

    return user;
  }

  update(id: number, updateUserDto: UpdateUserDto) {
    return `This action updates a #${id} user`;
  }

  remove(id: number) {
    return `This action removes a #${id} user`;
  }
}
