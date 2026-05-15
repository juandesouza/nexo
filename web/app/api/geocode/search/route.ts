import { NextRequest, NextResponse } from "next/server";

/** Proxy for Nominatim (required User-Agent; avoids browser CORS issues). */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) {
    return NextResponse.json([]);
  }

  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=8`;
  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "Accept-Language": "en",
        "User-Agent": "NexoLocalDev/1.0 (ride demo; +https://localhost)"
      },
      cache: "no-store"
    });
    if (!res.ok) {
      return NextResponse.json([], { status: 502 });
    }
    const data = (await res.json()) as unknown;
    return NextResponse.json(Array.isArray(data) ? data : []);
  } catch {
    return NextResponse.json([], { status: 502 });
  }
}
