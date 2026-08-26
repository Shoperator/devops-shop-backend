import { IsOptional, IsString, Length, Matches } from 'class-validator';

export class CreateUserDto {
  @IsString()
  @Length(3, 64)
  @Matches(/^[a-zA-Z0-9._-]+$/, {
    message:
      'username may only contain letters, digits, dot, dash and underscore',
  })
  username: string;

  @IsString()
  @Length(1, 128)
  displayName: string;

  @IsString()
  @Length(8, 72)
  password: string;

  @IsOptional()
  @IsString()
  @Length(1, 128)
  walletAddress?: string;
}
