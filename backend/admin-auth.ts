import jwt from "jsonwebtoken";

const ADMIN_PASSWORD = "admin12345678";
const JWT_SECRET = "admin12345678";
const TOKEN_EXPIRY = "8h";

interface AdminPayload {
  role: "admin";
  iat?: number;
  exp?: number;
}

export function verifyAdminPassword(password: string): string | null {
  if (password !== ADMIN_PASSWORD) return null;
  return jwt.sign({ role: "admin" } as AdminPayload, JWT_SECRET, {
    expiresIn: TOKEN_EXPIRY,
  });
}

export function verifyAdminToken(token: string): AdminPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AdminPayload;
    if (decoded.role !== "admin") return null;
    return decoded;
  } catch {
    return null;
  }
}

export function requireAdminAuth(
  req: any,
  res: any,
  next: any,
): void {
  const header = String(req.headers?.authorization || "");
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";

  if (!token) {
    res.status(401).json({ error: "Token de admin obrigatório." });
    return;
  }

  const payload = verifyAdminToken(token);
  if (!payload) {
    res.status(401).json({ error: "Token inválido ou expirado." });
    return;
  }

  req.adminAuthorized = true;
  next();
}
