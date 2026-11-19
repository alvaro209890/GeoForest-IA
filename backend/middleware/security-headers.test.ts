/**
 * Cabeçalhos de segurança: sempre presentes; HSTS só quando a requisição
 * chegou por HTTPS (o backend também é usado em localhost sem TLS).
 */
import { describe, expect, it } from "vitest";
import type { Request, Response } from "express";
import { createSecurityHeaders, setStaticAssetHeaders, STATIC_ASSET_CSP } from "./security-headers";

function makeReq(headers: Record<string, string> = {}, protocol = "http") {
  return { headers, protocol } as unknown as Request;
}

function makeRes() {
  const headers: Record<string, string> = {};
  const res = {
    setHeader(key: string, value: string) {
      headers[key] = String(value);
    },
  };
  return { res: res as unknown as Response, headers };
}

function apply(headers: Record<string, string>, protocol = "http") {
  const middleware = createSecurityHeaders();
  const { res, headers: written } = makeRes();
  middleware(makeReq(headers, protocol), res, () => undefined);
  return written;
}

describe("createSecurityHeaders", () => {
  it("manda nosniff, frame-ancestors e referrer policy em HTTP local", () => {
    const headers = apply({});
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["Strict-Transport-Security"]).toBeUndefined();
  });

  it("manda HSTS quando o tunnel terminou TLS", () => {
    const headers = apply({ "x-forwarded-proto": "https" });
    expect(headers["Strict-Transport-Security"]).toBe("max-age=31536000");
  });

  it("não manda HSTS quando o proxy diz http", () => {
    const headers = apply({ "x-forwarded-proto": "http" });
    expect(headers["Strict-Transport-Security"]).toBeUndefined();
  });
});

describe("setStaticAssetHeaders", () => {
  it("impede que um arquivo enviado por usuário execute script", () => {
    const { res, headers } = makeRes();
    setStaticAssetHeaders(res);
    expect(headers["Content-Security-Policy"]).toBe(STATIC_ASSET_CSP);
    expect(headers["Content-Security-Policy"]).toContain("script-src 'none'");
    expect(headers["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
  });
});
