import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const clientScript = readFileSync(resolve(process.cwd(), "public/app.js"), "utf8");

describe("Client access-token handling", () => {

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

describe("XSS output validation", () => {
  it("accepts only generated PNG data URLs for ticket images", () => {
    expect(clientScript).toContain('!/^data:image\\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(source)');
    expect(clientScript).toContain('setTicketImage("#ticket-qr", ticket.qrCode)');
    expect(clientScript).toContain('setTicketImage("#ticket-barcode", ticket.codeBarres)');
  });

  it("uses a fixed allowlist for global-search navigation destinations", () => {
    expect(clientScript).toContain('billet: "#payments"');
    expect(clientScript).toContain('"départ": "#voyages"');
    expect(clientScript).toContain('"véhicule": "#flotte"');
    expect(clientScript).toContain('opération: "#reports"');
    expect(clientScript).not.toContain("option.dataset.searchHref = result.href");
  });
});
