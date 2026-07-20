// Multi-user auth: scrypt password hashing + DB-backed session tokens.
// Designed for the eventual Vercel + Neon Postgres migration: all state lives
// in the users/sessions tables (no in-process secrets), cookies carry only an
// opaque token, and every data row is scoped by user_id.
//
// Compatibility mode: until the FIRST user account exists, everything runs as
// the implicit "local" user with no login required. The first signup claims
// all legacy "local" data and becomes the admin.

import crypto from "crypto";
import { cookies } from "next/headers";
import { db, newId } from "./db";

export const LEGACY_USER_ID = "local";

/** Public deployments (Vercel or REQUIRE_AUTH=1) never allow the anonymous local user. */
export const authForced = () => Boolean(process.env.REQUIRE_AUTH ?? process.env.VERCEL);
export const SESSION_COOKIE = "liberde_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface User {
  id: string;
  email: string;
  name: string;
  is_admin: number;
  created_at: number;
}

function hashPassword(password: string, salt?: string): string {
  const s = salt ?? crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, s, 64).toString("hex");
  return `${s}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, expected] = stored.split(":");
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}

export function countUsers(): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;
}

export function getUserByEmail(email: string): (User & { password_hash: string }) | undefined {
  return db
    .prepare("SELECT * FROM users WHERE email = ?")
    .get(email.trim().toLowerCase()) as (User & { password_hash: string }) | undefined;
}

export function createUser(email: string, name: string, password: string): User {
  const isFirst = countUsers() === 0;
  const user: User & { password_hash: string } = {
    id: newId(),
    email: email.trim().toLowerCase(),
    name: name.trim(),
    password_hash: hashPassword(password),
    is_admin: isFirst ? 1 : 0,
    created_at: Date.now(),
  };
  db.prepare(
    "INSERT INTO users (id, email, name, password_hash, is_admin, created_at) VALUES (@id, @email, @name, @password_hash, @is_admin, @created_at)"
  ).run(user);
  if (isFirst) claimLegacyData(user.id);
  const { password_hash: _ph, ...safe } = user;
  void _ph;
  return safe;
}

/** The first real account inherits everything created in single-user mode. */
function claimLegacyData(userId: string) {
  for (const table of [
    "settings",
    "conversations",
    "projects",
    "memories",
    "skills",
    "connectors",
    "scheduled_tasks",
    "api_keys",
    "shared_chats",
  ]) {
    db.prepare(`UPDATE ${table} SET user_id = ? WHERE user_id = ?`).run(
      userId,
      LEGACY_USER_ID
    );
  }
}

export function checkLogin(email: string, password: string): User | null {
  const user = getUserByEmail(email);
  if (!user || !verifyPassword(password, user.password_hash)) return null;
  const { password_hash: _ph, ...safe } = user;
  void _ph;
  return safe;
}

export function createSession(userId: string): string {
  const token = crypto.randomBytes(32).toString("base64url");
  db.prepare(
    "INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)"
  ).run(sha256(token), userId, Date.now() + SESSION_TTL_MS, Date.now());
  return token;
}

export function destroySession(token: string) {
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token));
}

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

export function getUserByToken(token: string): User | undefined {
  const row = db
    .prepare(
      `SELECT u.id, u.email, u.name, u.is_admin, u.created_at FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ?`
    )
    .get(sha256(token), Date.now()) as User | undefined;
  return row;
}

/**
 * Resolve the acting user for a request.
 * - No accounts exist yet → the implicit "local" user (no login needed).
 * - Accounts exist → a valid session cookie is required; null means 401.
 */
export async function getRequestUserId(): Promise<string | null> {
  if (!authForced() && countUsers() === 0) return LEGACY_USER_ID;
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return getUserByToken(token)?.id ?? null;
}

export async function getRequestUser(): Promise<User | null> {
  if (!authForced() && countUsers() === 0) {
    return {
      id: LEGACY_USER_ID,
      email: "",
      name: "Local user",
      is_admin: 1,
      created_at: 0,
    };
  }
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return getUserByToken(token) ?? null;
}

export const unauthorized = () =>
  Response.json({ error: "Sign in required" }, { status: 401 });
