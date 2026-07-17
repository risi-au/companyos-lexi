import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "./middleware";

describe("middleware auth error surfacing (#90)", () => {
  it("redirects /?error=... to /sign-in preserving error and error_description", () => {
    const req = new NextRequest(
      "https://x.test/?error=invalid_client&error_description=nope",
    );
    const res = middleware(req);

    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    const location = res.headers.get("location");
    expect(location).toBeTruthy();
    const url = new URL(location!);
    expect(url.pathname).toBe("/sign-in");
    expect(url.searchParams.get("error")).toBe("invalid_client");
    expect(url.searchParams.get("error_description")).toBe("nope");
  });

  it("passes through /sign-in?error=... without redirect", () => {
    const req = new NextRequest("https://x.test/sign-in?error=invalid_client");
    const res = middleware(req);

    // NextResponse.next() is not a redirect
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });
});
