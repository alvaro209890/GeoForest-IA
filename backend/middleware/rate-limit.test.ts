/**
 * Contrato do rate limit: rota caras têm balde próprio, o IP real vem do
 * Cloudflare (o socket é sempre o tunnel) e o limite devolve 429 com
 * `Retry-After` em vez de derrubar a conexão.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { Request, Response } from "express";
import { __resetRateLimits, clientKey, createRateLimiters, isHeavyPath } from "./rate-limit";

function makeReq(pathname: string, headers: Record<string, string> = {}, remoteAddress = "10.0.0.1") {
  return {
    headers,
    originalUrl: pathname,
    url: pathname,
    socket: { remoteAddress },
  } as unknown as Request;
}

function makeRes() {
  const headers: Record<string, string> = {};
  const res = {
    statusCode: 200,
    body: null as any,
    setHeader(key: string, value: string) {
      headers[key] = String(value);
    },
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
  };
  return { res: res as unknown as Response, headers, raw: res };
}

function run(middleware: ReturnType<typeof createRateLimiters>, req: Request, res: Response) {
  let nextCalled = false;
  middleware(req, res, () => {
    nextCalled = true;
  });
  return nextCalled;
}

beforeEach(() => {
  __resetRateLimits();
});

describe("isHeavyPath", () => {
  it("marca as rotas de processamento e upload", () => {
    expect(isHeavyPath("/api/simcar/clip")).toBe(true);
    expect(isHeavyPath("/api/simcar/clip/analyze")).toBe(true);
    expect(isHeavyPath("/api/croqui/upload")).toBe(true);
    expect(isHeavyPath("/api/chat-stream")).toBe(true);
    expect(isHeavyPath("/api/apf/search")).toBe(true);
    expect(isHeavyPath("/api/landsat/wms-download")).toBe(true);
  });

  it("não marca leitura barata nem health", () => {
    expect(isHeavyPath("/api/health")).toBe(false);
    expect(isHeavyPath("/api/models")).toBe(false);
    expect(isHeavyPath("/api/simcar/layers")).toBe(false);
    expect(isHeavyPath("/api/store/doc")).toBe(false);
  });
});

describe("clientKey", () => {
  it("usa o IP do Cloudflare antes do socket", () => {
    const req = makeReq("/api/health", {
      "cf-connecting-ip": "203.0.113.9",
      "x-forwarded-for": "198.51.100.4, 10.0.0.1",
    });
    expect(clientKey(req)).toBe("203.0.113.9");
  });

  it("cai no primeiro X-Forwarded-For sem Cloudflare", () => {
    const req = makeReq("/api/health", { "x-forwarded-for": "198.51.100.4, 10.0.0.1" });
    expect(clientKey(req)).toBe("198.51.100.4");
  });

  it("usa o socket em chamada local", () => {
    const req = makeReq("/api/health", {}, "127.0.0.1");
    expect(clientKey(req)).toBe("127.0.0.1");
  });
});

describe("createRateLimiters", () => {
  it("deixa passar o uso normal e bloqueia a rota cara ao estourar", () => {
    const limiter = createRateLimiters();
    const req = makeReq("/api/simcar/clip", { "cf-connecting-ip": "203.0.113.10" });

    for (let i = 0; i < 60; i += 1) {
      const { res } = makeRes();
      expect(run(limiter, req, res)).toBe(true);
    }

    const blocked = makeRes();
    expect(run(limiter, req, blocked.res)).toBe(false);
    expect(blocked.raw.statusCode).toBe(429);
    expect((blocked.raw.body as any).code).toBe("RATE_LIMITED");
    expect(Number(blocked.headers["Retry-After"])).toBeGreaterThan(0);
  });

  it("baldes são por IP — um cliente abusivo não bloqueia outro", () => {
    const limiter = createRateLimiters();
    const abusive = makeReq("/api/simcar/clip", { "cf-connecting-ip": "203.0.113.11" });
    for (let i = 0; i < 61; i += 1) run(limiter, abusive, makeRes().res);

    const other = makeReq("/api/simcar/clip", { "cf-connecting-ip": "203.0.113.12" });
    expect(run(limiter, other, makeRes().res)).toBe(true);
  });

  it("rota barata não consome o balde das rotas caras", () => {
    const limiter = createRateLimiters();
    const ip = { "cf-connecting-ip": "203.0.113.13" };
    for (let i = 0; i < 100; i += 1) run(limiter, makeReq("/api/health", ip), makeRes().res);
    expect(run(limiter, makeReq("/api/simcar/clip", ip), makeRes().res)).toBe(true);
  });
});
