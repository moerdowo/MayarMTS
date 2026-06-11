import { NextRequest, NextResponse } from "next/server";

const MAYAR_BASE = "https://api.mayar.id/hl/v1";

export async function GET(req: NextRequest) {
  const apiKey = req.headers.get("x-mayar-key");
  if (!apiKey) {
    return NextResponse.json(
      { statusCode: 400, messages: "missing x-mayar-key header" },
      { status: 400 }
    );
  }

  const { searchParams } = new URL(req.url);
  const page = searchParams.get("page") ?? "1";
  const pageSize = searchParams.get("pageSize") ?? "100";

  try {
    const res = await fetch(
      `${MAYAR_BASE}/transactions?page=${encodeURIComponent(page)}&pageSize=${encodeURIComponent(pageSize)}`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
        },
        cache: "no-store",
      }
    );
    const body = await res.text();
    return new NextResponse(body, {
      status: res.status,
      headers: { "content-type": "application/json" },
    });
  } catch {
    return NextResponse.json(
      { statusCode: 502, messages: "upstream request to api.mayar.id failed" },
      { status: 502 }
    );
  }
}
