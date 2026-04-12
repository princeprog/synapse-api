export class UpdateUserDto {
  username?: string;
  email?: string;
  password?: string;
  status?: 'active' | 'offline';
  display_name?: string;
  avatar_url?: string | null;
  bio?: string;
  timezone?: string | null;
}
