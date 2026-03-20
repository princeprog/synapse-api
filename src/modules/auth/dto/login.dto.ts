import { ApiOperation, ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ example: 'alprince', description: "The user's username" })
  username!: string;

  @ApiProperty({ example: '1234567890', description: "The user's password" })
  password!: string;
}
