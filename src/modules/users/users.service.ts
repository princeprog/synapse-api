import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { DB } from 'src/database/database.types';
import { Kysely } from 'kysely';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UsersService {
  constructor(@Inject('KYSELY_DB') private readonly db: Kysely<DB>) {}

  async getProfileByUserId(userId: string) {
    const userProfile = await this.db
      .selectFrom('auth.users as u')
      .select([
        'u.id',
        'u.username',
        'u.email',
        'u.is_active',
        'u.created_at',
      ])
      .where('u.id', '=', userId)
      .executeTakeFirst();

    if (!userProfile) {
      throw new NotFoundException('User profile not found');
    }

    return userProfile;
  }

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
    const { username, email, password } = updateUserDto;

    const authUpdate: {
      username?: string;
      email?: string;
      password_hash?: string;
    } = {};

    if (username !== undefined) authUpdate.username = username;
    if (email !== undefined) authUpdate.email = email;
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
      // TODO: Profile fields (display_name, avatar_url, bio, timezone) update
      // requires user_profiles table to be created in the database
      const profileUpdate: {
        display_name?: string | null;
        avatar_url?: string | null;
        bio?: string | null;
        timezone?: string | null;
      } = {};

      if (updateUserDto.display_name !== undefined) {
        profileUpdate.display_name = updateUserDto.display_name;
      }
      if (updateUserDto.avatar_url !== undefined) {
        profileUpdate.avatar_url = updateUserDto.avatar_url;
      }
      if (updateUserDto.bio !== undefined) {
        profileUpdate.bio = updateUserDto.bio;
      }
      if (updateUserDto.timezone !== undefined) {
        profileUpdate.timezone = updateUserDto.timezone;
      }

      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      await (this.db as any)
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        .insertInto('auth.user_profiles')
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        .values({ user_id: id, ...profileUpdate })
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        .onConflict((oc: any) =>
          // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
          oc.column('user_id').doUpdateSet(profileUpdate),
        )
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        .executeTakeFirst();
    }

    const updatedUser = await this.db
      .selectFrom('auth.users as u')
      .select([
        'u.id',
        'u.username',
        'u.email',
        'u.is_active',
        'u.created_at',
      ])
      .where('u.id', '=', id)
      .executeTakeFirst();

    return updatedUser;
  }

  async setStatus(userId: string, isActive: boolean) {
    const result = await this.db
      .updateTable('auth.users')
      .set({ is_active: isActive })
      .where('id', '=', userId)
      .executeTakeFirst();

    if (result.numUpdatedRows === 0n) {
      throw new NotFoundException('User not found');
    }

    return { userId, isActive };
  }

  remove(id: number) {
    return `This action removes a #${id} user`;
  }
}
