import { User, UserRole } from '../entities/user.entity';

export class UserResponseDto {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  walletAddress: string | null;

  static fromEntity(user: User): UserResponseDto {
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      walletAddress: user.walletAddress,
    };
  }
}
