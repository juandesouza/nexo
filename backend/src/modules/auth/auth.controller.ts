import {
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Req,
  UnauthorizedException,
  UseGuards
} from "@nestjs/common";
import { IsEmail, IsIn, IsOptional, IsString, MinLength } from "class-validator";
import { AuthService } from "./auth.service";
import { JwtAuthGuard } from "./jwt-auth.guard";

interface AuthedRequest {
  user: { sub: string; email?: string; role?: string };
}

type UserRole = "passenger" | "driver";

class SignUpDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsIn(["passenger", "driver"])
  role!: UserRole;
}

class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;
}

class GoogleAuthDto {
  @IsString()
  token!: string;

  @IsIn(["passenger", "driver"])
  @IsOptional()
  role?: UserRole;
}

class ForgotPasswordDto {
  @IsEmail()
  email!: string;
}

class ResetPasswordDto {
  @IsString()
  token!: string;

  @IsString()
  @MinLength(8)
  newPassword!: string;
}

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("signup")
  signUp(@Body() payload: SignUpDto) {
    return this.authService.signUp(payload);
  }

  @Post("login")
  login(@Body() payload: LoginDto) {
    return this.authService.login(payload);
  }

  @Post("google")
  google(@Body() payload: GoogleAuthDto) {
    return this.authService.googleAuth(payload);
  }

  @Post("forgot-password")
  forgotPassword(@Body() payload: ForgotPasswordDto) {
    return this.authService.requestPasswordReset(payload.email);
  }

  @Post("reset-password")
  resetPassword(@Body() payload: ResetPasswordDto) {
    return this.authService.resetPassword(payload.token, payload.newPassword);
  }

  @Get("me")
  @UseGuards(JwtAuthGuard)
  me(@Req() req: AuthedRequest) {
    const sub = req.user?.sub;
    if (!sub) {
      throw new UnauthorizedException();
    }
    return this.authService.getProfile(sub);
  }

  @Delete("account")
  @UseGuards(JwtAuthGuard)
  deleteAccount(@Req() req: AuthedRequest) {
    const sub = req.user?.sub;
    if (!sub) {
      throw new UnauthorizedException();
    }
    return this.authService.deleteAccount(sub);
  }
}
