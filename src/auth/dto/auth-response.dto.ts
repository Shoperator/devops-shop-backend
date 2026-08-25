import { UserResponseDto } from '../../users/dto/user-response.dto';

export class AuthResponseDto {
  accessToken: string;
  tokenType: string;
  user: UserResponseDto;
}
