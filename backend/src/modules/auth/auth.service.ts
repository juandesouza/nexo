import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { compare, hash } from "bcryptjs";
import { OAuth2Client } from "google-auth-library";
import { randomUUID } from "node:crypto";

type UserRole = "passenger" | "driver";

type AuthUser = {
  id: string;
  email: string;
  passwordHash?: string;
  role: UserRole;
  provider: "email" | "google";
};

type AuthResponse = {
  accessToken: string;
  user: { id: string; email: string; role: UserRole; provider: "email" | "google" };
};

@Injectable()
export class AuthService {
  private readonly resetTokens = new Map<string, string>();
  private readonly usersByEmail = new Map<string, AuthUser>();
  private readonly googleClient = new OAuth2Client();

  constructor(private readonly jwtService: JwtService) {}

  async signUp(payload: { email: string; password: string; role: UserRole }): Promise<AuthResponse> {
    const email = payload.email.trim().toLowerCase();
    if (this.usersByEmail.has(email)) {
      throw new ConflictException("Email already registered.");
    }

    const passwordHash = await hash(payload.password, 10);
    const user: AuthUser = {
      id: randomUUID(),
      email,
      passwordHash,
      role: payload.role,
      provider: "email"
    };
    this.usersByEmail.set(email, user);
    return this.issueAuthResponse(user);
  }

  async login(payload: { email: string; password: string }): Promise<AuthResponse> {
    const email = payload.email.trim().toLowerCase();
    const user = this.usersByEmail.get(email);
    if (!user || !user.passwordHash || user.provider !== "email") {
      throw new UnauthorizedException("Invalid email or password.");
    }

    const matches = await compare(payload.password, user.passwordHash);
    if (!matches) {
      throw new UnauthorizedException("Invalid email or password.");
    }

    return this.issueAuthResponse(user);
  }

  async googleAuth(payload: { token: string; role?: UserRole }): Promise<AuthResponse> {
    const audience = [
      process.env.GOOGLE_OAUTH_WEB_CLIENT_ID ?? "",
      process.env.GOOGLE_OAUTH_MOBILE_CLIENT_ID ?? ""
    ].filter(Boolean);

    if (audience.length === 0) {
      throw new BadRequestException("Google OAuth client IDs are not configured.");
    }

    const ticket = await this.googleClient.verifyIdToken({
      idToken: payload.token,
      audience
    });
    const tokenPayload = ticket.getPayload();
    const email = tokenPayload?.email?.toLowerCase();
    if (!email || !tokenPayload?.email_verified) {
      throw new UnauthorizedException("Google account email is missing or unverified.");
    }

    const existing = this.usersByEmail.get(email);
    if (existing) {
      return this.issueAuthResponse(existing);
    }

    const user: AuthUser = {
      id: randomUUID(),
      email,
      role: payload.role ?? "passenger",
      provider: "google"
    };
    this.usersByEmail.set(email, user);
    return this.issueAuthResponse(user);
  }

  requestPasswordReset(email: string) {
    const token = randomUUID();
    this.resetTokens.set(token, email);
    const resetUrl = `${process.env.PUBLIC_RESET_URL}?token=${token}`;

    // SMTP wiring point: send email with nodemailer transport using validated env.
    return {
      ok: true,
      email,
      resetUrl
    };
  }

  resetPassword(token: string, _newPassword: string) {
    const email = this.resetTokens.get(token);
    if (!email) {
      return { ok: false, message: "Invalid or expired token" };
    }
    this.resetTokens.delete(token);
    return { ok: true, email };
  }

  deleteAccount(userId: string) {
    let removed = false;
    for (const [email, u] of this.usersByEmail) {
      if (u.id === userId) {
        this.usersByEmail.delete(email);
        removed = true;
        break;
      }
    }
    if (!removed) {
      throw new UnauthorizedException("Account not found.");
    }
    return { ok: true };
  }

  getProfile(userId: string) {
    const user = [...this.usersByEmail.values()].find((u) => u.id === userId);
    if (!user) {
      throw new UnauthorizedException("User not found.");
    }
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      provider: user.provider
    };
  }

  private issueAuthResponse(user: AuthUser): AuthResponse {
    const accessToken = this.jwtService.sign({
      sub: user.id,
      email: user.email,
      role: user.role,
      provider: user.provider
    });

    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        provider: user.provider
      }
    };
  }
}
