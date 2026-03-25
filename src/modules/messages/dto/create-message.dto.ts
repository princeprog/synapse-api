import { ApiProperty } from "@nestjs/swagger";

export class CreateMessageDto {

    @ApiProperty({example: 'sample message', description:"this is user's message content"})
    content!: string

    @ApiProperty({example: 'Parent of the message' , description: "Parent of the user's replied message"})
    parentId?: string
}
