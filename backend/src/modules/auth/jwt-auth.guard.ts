import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      headers?: { authorization?: string };
      user?: { sub?: string; email?: string; role?: string };
    }>();
    const raw = request.headers?.authorization ?? "";
    const token = typeof raw === "string" && raw.startsWith("Bearer ") ? raw.slice(7).trim() : "";
    if (!token) {
      throw new UnauthorizedException();
    }

    try {
      request.user = this.jwtService.verify(token);
      return true;
    } catch {
      throw new UnauthorizedException();
    }
  }
}
