import { IsOptional, IsString, Length } from 'class-validator';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @Length(1, 128)
  displayName?: string;

  @IsOptional()
  @IsString()
  @Length(1, 128)
  walletAddress?: string;
}
