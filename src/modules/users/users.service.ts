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

  async updateUser(id: string, updateUserDto: UpdateUserDto) {
    const { username, email, password, status } = updateUserDto;

    const authUpdate: {
      username?: string;
      email?: string;
      password_hash?: string;
      status?: string;
    } = {};

    if (username !== undefined) authUpdate.username = username;
    if (email !== undefined) authUpdate.email = email;
    if (status !== undefined) authUpdate.status = status;
    if (password !== undefined) {
      authUpdate.password_hash = await bcrypt.hash(password, 10);
    }

    if (Object.keys(authUpdate).length > 0) {
      await this.db
        .updateTable('auth.users')
        .set(authUpdate)
        .where('id', '=', id)
        .executeTakeFirst();
    }

    const hasProfileFields =
      updateUserDto.display_name !== undefined ||
      updateUserDto.avatar_url !== undefined ||
      updateUserDto.bio !== undefined ||
      updateUserDto.timezone !== undefined;

    if (hasProfileFields) {
      await this.db
        .insertInto('auth.user_profiles')
        .values({
          user_id: id,
          display_name: updateUserDto.display_name ?? null,
          avatar_url: updateUserDto.avatar_url ?? null,
          bio: updateUserDto.bio ?? null,
          timezone: updateUserDto.timezone ?? null,
        })
        .onConflict((oc) =>
          oc.column('user_id').doUpdateSet({
            display_name: updateUserDto.display_name ?? null,
            avatar_url: updateUserDto.avatar_url ?? null,
            bio: updateUserDto.bio ?? null,
            timezone: updateUserDto.timezone ?? null,
          }),
        )
        .executeTakeFirst();
    }

    const updatedUser = await this.db
      .selectFrom('auth.users as u')
      .leftJoin('auth.user_profiles as up', 'up.user_id', 'u.id')
      .select([
        'u.id',
        'u.username',
        'u.email',
        'u.status',
        'u.is_active',
        'u.created_at',
        'up.display_name',
        'up.avatar_url',
        'up.bio',
        'up.timezone',
      ])
      .where('u.id', '=', id)
      .executeTakeFirst();

    return updatedUser;
  }

  remove(id: number) {
    return `This action removes a #${id} user`;
  }
}
