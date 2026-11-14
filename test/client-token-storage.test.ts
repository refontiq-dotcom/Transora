import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Client access-token handling", () => {
  const clientScript = readFileSync(resolve(process.cwd(), "public/app.js"), "utf8");

  it("does not read or write access tokens in browser localStorage and clears legacy storage", () => {
    expect(clientScript).not.toContain('localStorage.getItem("transora_token")');
    expect(clientScript).not.toContain('localStorage.setItem("transora_token"');
    expect(clientScript).toContain('localStorage.removeItem("transora_token")');
  });

  it("keeps access tokens in memory and attaches them to same-origin API requests", () => {
    expect(clientScript).toContain("let accessToken = null");
    expect(clientScript).toContain("window.fetch = async (input, init = {})");
    expect(clientScript).toContain('headers.set("Authorization", `Bearer ${accessToken}`)');
  });

  it("restores sessions through the HttpOnly refresh cookie and retries one expired request", () => {
    expect(clientScript).toContain('nativeFetch("/api/v1/auth/refresh"');
    expect(clientScript).toContain('credentials: "same-origin"');
    expect(clientScript).toContain("response.status === 401 && !attemptedRefresh && await refreshAccessToken()");
    expect(clientScript).toContain("refreshAccessToken().then((restored) =>");
  });
});
