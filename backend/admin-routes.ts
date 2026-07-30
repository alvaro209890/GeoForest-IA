import { Router, type Request, type Response } from "express";
import { readDocBySegments, writeDocBySegments, deleteDocBySegments } from "./local-storage";
import { requireAdminAuth, verifyAdminPassword } from "./admin-auth";
import fs from "node:fs";
import path from "node:path";
import { STORAGE_ROOT } from "./local-storage";

const router = Router();

// ── Login ────────────────────────────────────────────────────────────
router.post("/admin/login", (req: Request, res: Response) => {
  const { password } = (req.body || {}) as { password?: string };
  const token = verifyAdminPassword(password || "");
  if (!token) {
    res.status(401).json({ error: "Senha incorreta." });
    return;
  }
  res.json({ ok: true, token });
});

// ── Verificar sessão ─────────────────────────────────────────────────
router.get("/admin/session", requireAdminAuth, (_req: Request, res: Response) => {
  res.json({ ok: true, role: "admin" });
});

// ── Listar usuários com storage ──────────────────────────────────────
router.get("/admin/users", requireAdminAuth, (_req: Request, res: Response) => {
  try {
    const usersDir = path.join(STORAGE_ROOT, "users");
    const blockedEntries = listBlocked();
    const blockedMap = new Map(blockedEntries.map((b) => [b.uid, b]));

    if (!fs.existsSync(usersDir)) {
      res.json({ users: [], total: 0 });
      return;
    }

    const entries = fs.readdirSync(usersDir, { withFileTypes: true });
    const users: any[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const uid = entry.name;

      // Ler profile
      const profilePath = path.join(usersDir, uid, "profile.json");
      let profile: any = null;
      if (fs.existsSync(profilePath)) {
        try {
          profile = JSON.parse(fs.readFileSync(profilePath, "utf-8"));
        } catch {
          profile = null;
        }
      }

      const storageBytes = calcUserStorage(uid);
      const block = blockedMap.get(uid);

      users.push({
        uid,
        email: profile?.email || "",
        fullName: profile?.fullName || "",
        createdAt: profile?.createdAt || "",
        storageBytes,
        storageMB: +(storageBytes / (1024 * 1024)).toFixed(2),
        blocked: !!block,
        blockedAt: block?.blockedAt || null,
        expiresAt: block?.expiresAt || null,
        reason: block?.reason || null,
      });
    }

    // Ordenar por storage (maior primeiro)
    users.sort((a, b) => b.storageBytes - a.storageBytes);

    res.json({ users, total: users.length });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Erro ao listar usuários." });
  }
});

// ── Bloquear usuário ─────────────────────────────────────────────────
router.post("/admin/users/:uid/block", requireAdminAuth, (req: Request, res: Response) => {
  try {
    const { uid } = req.params;
    const { reason, expiresAt } = (req.body || {}) as {
      reason?: string;
      expiresAt?: string | null;
    };

    const profile = readDocBySegments(["users", uid]);
    if (!profile) {
      res.status(404).json({ error: "Usuário não encontrado." });
      return;
    }

    const blockEntry: any = {
      uid,
      email: (profile as any).email || "",
      fullName: (profile as any).fullName || "",
      blockedAt: new Date().toISOString(),
      expiresAt: expiresAt || null,
      reason: reason || "",
    };

    writeDocBySegments(["system", "blocklist", uid], blockEntry);
    res.json({ ok: true, entry: blockEntry });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Erro ao bloquear." });
  }
});

// ── Desbloquear usuário ──────────────────────────────────────────────
router.post("/admin/users/:uid/unblock", requireAdminAuth, (req: Request, res: Response) => {
  try {
    const { uid } = req.params;
    deleteDocBySegments(["system", "blocklist", uid]);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Erro ao desbloquear." });
  }
});

// ── Stats gerais do sistema ──────────────────────────────────────────
router.get("/admin/stats", requireAdminAuth, (_req: Request, res: Response) => {
  try {
    const usersDir = path.join(STORAGE_ROOT, "users");
    let totalUsers = 0;
    let totalStorage = 0;
    let blockedCount = 0;

    if (fs.existsSync(usersDir)) {
      const entries = fs.readdirSync(usersDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        totalUsers++;
        totalStorage += calcUserStorage(entry.name);
      }
    }

    const blockedEntries = listBlocked();
    blockedCount = blockedEntries.length;

    // Disco
    const disk = getDiskInfo();
    // Memória
    const mem = getMemInfo();

    res.json({
      totalUsers,
      blockedCount,
      activeUsers: totalUsers - blockedCount,
      totalStorageBytes: totalStorage,
      totalStorageGB: +(totalStorage / (1024 * 1024 * 1024)).toFixed(2),
      disk,
      memory: mem,
      uptime: process.uptime(),
      nodeVersion: process.version,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Erro ao obter stats." });
  }
});

// ── Info de um usuário específico (detalhado) ────────────────────────
router.get("/admin/users/:uid", requireAdminAuth, (req: Request, res: Response) => {
  try {
    const { uid } = req.params;
    const userDir = path.join(STORAGE_ROOT, "users", uid);

    if (!fs.existsSync(userDir)) {
      res.status(404).json({ error: "Usuário não encontrado." });
      return;
    }

    const profile = readDocBySegments(["users", uid]);
    const storageBytes = calcUserStorage(uid);
    const blockEntry = readDocBySegments(["system", "blocklist", uid]);

    // Listar arquivos do usuário
    const fileList = listUserFiles(uid);

    res.json({
      uid,
      email: (profile as any)?.email || "",
      fullName: (profile as any)?.fullName || "",
      createdAt: (profile as any)?.createdAt || "",
      storageBytes,
      storageMB: +(storageBytes / (1024 * 1024)).toFixed(2),
      blocked: !!blockEntry,
      blockEntry: blockEntry || null,
      files: fileList,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Erro ao obter usuário." });
  }
});

// ── Helpers ──────────────────────────────────────────────────────────

function listBlocked(): any[] {
  const blocklistDir = path.join(STORAGE_ROOT, "system", "blocklist");
  if (!fs.existsSync(blocklistDir)) return [];
  const entries = fs.readdirSync(blocklistDir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".json"))
    .map((e) => {
      try {
        return JSON.parse(
          fs.readFileSync(path.join(blocklistDir, e.name), "utf-8"),
        );
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function calcUserStorage(uid: string): number {
  const userDir = path.join(STORAGE_ROOT, "users", uid);
  if (!fs.existsSync(userDir)) return 0;

  let total = 0;
  function walk(dir: string) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile()) {
          try {
            total += fs.statSync(full).size;
          } catch {
            // ignore locked files
          }
        }
      }
    } catch {
      // ignore permission errors
    }
  }
  walk(userDir);
  return total;
}

function listUserFiles(uid: string): { path: string; size: number }[] {
  const userDir = path.join(STORAGE_ROOT, "users", uid);
  if (!fs.existsSync(userDir)) return [];

  const result: { path: string; size: number }[] = [];
  function walk(dir: string, prefix: string) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          walk(full, rel);
        } else if (entry.isFile()) {
          try {
            result.push({ path: rel, size: fs.statSync(full).size });
          } catch {
            // skip
          }
        }
      }
    } catch {
      // skip
    }
  }
  walk(userDir, "");
  result.sort((a, b) => b.size - a.size);
  return result;
}

function getDiskInfo(): { totalGB: number; usedGB: number; freeGB: number; pct: number } | null {
  try {
    // Linux: usa /proc/mounts pra achar o mount do STORAGE_ROOT
    const stat = fs.statfsSync(STORAGE_ROOT);
    const total = (stat.blocks * stat.bsize) / (1024 * 1024 * 1024);
    const free = (stat.bfree * stat.bsize) / (1024 * 1024 * 1024);
    const used = total - free;
    return {
      totalGB: +total.toFixed(2),
      usedGB: +used.toFixed(2),
      freeGB: +free.toFixed(2),
      pct: total > 0 ? +((used / total) * 100).toFixed(1) : 0,
    };
  } catch {
    return null;
  }
}

function getMemInfo(): { totalGB: number; freeGB: number; pct: number } | null {
  try {
    const meminfo = fs.readFileSync("/proc/meminfo", "utf-8");
    const totalMatch = meminfo.match(/MemTotal:\s+(\d+)/);
    const availMatch = meminfo.match(/MemAvailable:\s+(\d+)/);
    if (!totalMatch) return null;
    const totalKB = parseInt(totalMatch[1], 10);
    const availKB = availMatch ? parseInt(availMatch[1], 10) : 0;
    const totalGB = totalKB / (1024 * 1024);
    const usedGB = (totalKB - availKB) / (1024 * 1024);
    return {
      totalGB: +totalGB.toFixed(2),
      freeGB: +(availKB / (1024 * 1024)).toFixed(2),
      pct: totalKB > 0 ? +((usedGB / totalGB) * 100).toFixed(1) : 0,
    };
  } catch {
    return null;
  }
}

export default router;
