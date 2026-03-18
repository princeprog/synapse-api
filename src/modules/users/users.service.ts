import { Injectable, Inject } from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { DB } from 'src/database/database.types';
import { Kysely } from 'kysely';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UsersService {
  constructor(@Inject('KYSELY_DB') private readonly db: Kysely<DB>) {}

  async create(createUserDto: CreateUserDto) {
    const { username, email, password } = createUserDto;
    const password_hash = await bcrypt.hash(password, 10);

    const newUser = await this.db
      .insertInto('auth.users')
      .values({
        username,
        email,
        password_hash,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return newUser;
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

    if (!user) {
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
