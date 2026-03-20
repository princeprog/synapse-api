import { ApiProperty } from '@nestjs/swagger';

export class CreateUserDto {
  @ApiProperty({ example: 'alice', description: "The user's username" })
  username!: string;

  @ApiProperty({
    example: 'alice@example.com',
    description: "The user's email",
  })
  email!: string;

  @ApiProperty({ example: 'password123', description: "The user's password" })
  password!: string;
}
