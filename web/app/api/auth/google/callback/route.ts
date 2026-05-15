import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

function backendGoogleAuthUrl(): string {
  const base = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000").replace(/\/$/, "");
  const version = process.env.NEXT_PUBLIC_BACKEND_VERSION ?? "v1";
  return `${base}/api/${version}/auth/google`;
}

type BridgeUser = {
  id: string;
  email: string;
  role: "passenger" | "driver";
  provider: "email" | "google";
};

function htmlBridge(accessToken: string, user: BridgeUser): NextResponse {
  const userJsonForStorage = JSON.stringify(user);
  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="robots" content="noindex"/><title>NEXO</title></head>
<body>
<script>
  (function () {
    try {
      localStorage.setItem("nexo_access_token", ${JSON.stringify(accessToken)});
      localStorage.setItem("nexo_user", ${JSON.stringify(userJsonForStorage)});
    } catch (e) {}
    window.location.replace(${JSON.stringify("/")});
  })();
</script>
<p style="font-family:sans-serif;padding:24px">Signing you in…</p>
</body>
</html>`;

  return new NextResponse(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function redirectError(request: NextRequest, code: string): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = "/";
  url.search = "";
  url.searchParams.set("google_err", code);
  return NextResponse.redirect(url);
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const credential = formData.get("credential");
  const bodyCsrf = formData.get("g_csrf_token");

  const jar = await cookies();
  const cookieCsrf = jar.get("g_csrf_token")?.value;

  if (!credential || typeof credential !== "string") {
    return redirectError(request, "missing_credential");
  }

  const skipCsrf = process.env.SKIP_GOOGLE_GSI_CSRF === "true";
  if (
    !skipCsrf &&
    (typeof bodyCsrf !== "string" || !cookieCsrf || bodyCsrf !== cookieCsrf)
  ) {
    return redirectError(request, "csrf_mismatch");
  }

  const roleRaw = jar.get("nexo_oauth_role")?.value;
  const role =
    roleRaw === "driver"
      ? "driver"
      : roleRaw === "passenger"
        ? "passenger"
        : undefined;

  try {
    const res = await fetch(backendGoogleAuthUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(role ? { token: credential, role } : { token: credential })
    });

    if (!res.ok) {
      let msg = `${res.status}`;
      try {
        const errBody = await res.json();
        if (errBody && typeof errBody === "object" && "message" in errBody) {
          msg += `_${String((errBody as { message?: string }).message).slice(0, 120)}`;
        }
      } catch {
        //
      }
      return redirectError(request, `backend_${msg}`);
    }

    const data = (await res.json()) as { accessToken?: string; user?: BridgeUser };
    if (!data.accessToken || !data.user?.id || !data.user?.email || !data.user?.role || !data.user?.provider) {
      return redirectError(request, !data.accessToken ? "missing_token" : "missing_user");
    }

    return htmlBridge(data.accessToken, data.user);
  } catch {
    return redirectError(request, "backend_unreachable");
  }
}
