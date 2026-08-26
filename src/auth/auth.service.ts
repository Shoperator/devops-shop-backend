import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { compare } from 'bcryptjs';
import { CreateUserDto } from '../users/dto/create-user.dto';
import { UserResponseDto } from '../users/dto/user-response.dto';
import { User } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { AuthResponseDto } from './dto/auth-response.dto';
import { LoginDto } from './dto/login.dto';
import { JwtPayload } from './types/jwt-payload';

const TOKEN_TYPE = 'Bearer';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  async register(dto: CreateUserDto): Promise<UserResponseDto> {
    const user = await this.usersService.createCustomer(dto);
    return UserResponseDto.fromEntity(user);
  }

  async login(dto: LoginDto): Promise<AuthResponseDto> {
    const user = await this.usersService.findByUsername(dto.username);

    // One message for both cases, so the response cannot be used to find out
    // which usernames exist.
    if (user === null || !(await compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid username or password');
    }

    return this.issueToken(user);
  }

  async getProfile(userId: string): Promise<UserResponseDto> {
    const user = await this.usersService.getById(userId);
    return UserResponseDto.fromEntity(user);
  }

  private async issueToken(user: User): Promise<AuthResponseDto> {
    const payload: JwtPayload = {
      sub: user.id,
      username: user.username,
      role: user.role,
    };

    return {
      accessToken: await this.jwtService.signAsync(payload),
      tokenType: TOKEN_TYPE,
      user: UserResponseDto.fromEntity(user),
    };
  }
}
