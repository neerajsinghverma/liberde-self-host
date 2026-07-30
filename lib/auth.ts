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
  email_verified?: number;
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

type UserRow = User & {
  password_hash: string;
  failed_logins?: number;
  locked_until?: number;
};

export function getUserByEmail(email: string): UserRow | undefined {
  return db
    .prepare("SELECT * FROM users WHERE email = ?")
    .get(email.trim().toLowerCase()) as UserRow | undefined;
}

export function createUser(email: string, name: string, password: string): User {
  const isFirst = countUsers() === 0;
  // First account is admin AND auto-verified (never lock the operator out).
  const user: User & { password_hash: string } = {
    id: newId(),
    email: email.trim().toLowerCase(),
    name: name.trim(),
    password_hash: hashPassword(password),
    is_admin: isFirst ? 1 : 0,
    email_verified: isFirst ? 1 : 0,
    created_at: Date.now(),
  };
  db.prepare(
    "INSERT INTO users (id, email, name, password_hash, is_admin, email_verified, created_at) VALUES (@id, @email, @name, @password_hash, @is_admin, @email_verified, @created_at)"
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

// Brute-force protection: after this many consecutive failed logins the account
// is temporarily locked. The lock AUTO-EXPIRES (so an attacker who knows a
// victim's email can't lock them out forever) and an admin can clear it
// immediately (Settings → Admin → Unlock). DB-backed, so it holds regardless of
// process restarts — the real defense against online password guessing.
export const LOGIN_MAX_FAILS = 10;
export const LOGIN_LOCK_MS = 15 * 60 * 1000; // 15 minutes

export type LoginResult =
  | { ok: true; user: User }
  | { ok: false; reason: "invalid" }
  | { ok: false; reason: "locked"; until: number };

/** Verify credentials with durable lockout; updates the failure counter/lock. */
export function attemptLogin(email: string, password: string): LoginResult {
  const user = getUserByEmail(email);
  if (!user) return { ok: false, reason: "invalid" };
  const now = Date.now();
  const lockedUntil = Number(user.locked_until ?? 0);
  if (lockedUntil > now) return { ok: false, reason: "locked", until: lockedUntil };

  if (verifyPassword(password, user.password_hash)) {
    if (Number(user.failed_logins ?? 0) > 0 || lockedUntil) {
      db.prepare("UPDATE users SET failed_logins = 0, locked_until = 0 WHERE id = ?").run(user.id);
    }
    const { password_hash: _ph, ...safe } = user;
    void _ph;
    return { ok: true, user: safe };
  }

  // Wrong password → increment; at the cap, lock and reset the counter so the
  // account gets a fresh set of tries once the lock expires.
  const fails = Number(user.failed_logins ?? 0) + 1;
  if (fails >= LOGIN_MAX_FAILS) {
    const until = now + LOGIN_LOCK_MS;
    db.prepare("UPDATE users SET failed_logins = 0, locked_until = ? WHERE id = ?").run(until, user.id);
    return { ok: false, reason: "locked", until };
  }
  db.prepare("UPDATE users SET failed_logins = ? WHERE id = ?").run(fails, user.id);
  return { ok: false, reason: "invalid" };
}

/** Admin action: clear a lockout + failed-attempt counter for a user. */
export function unlockUser(userId: string): void {
  db.prepare("UPDATE users SET failed_logins = 0, locked_until = 0 WHERE id = ?").run(userId);
}

/**
 * Admin-initiated password reset: set a fresh random temp password, sign the
 * user out everywhere, and clear any lockout. Returns the plaintext temp
 * password ONCE for the admin to relay out-of-band — it is stored only hashed
 * and cannot be retrieved again.
 */
export function adminResetPassword(userId: string): string {
  const temp = crypto.randomBytes(9).toString("base64url"); // 12 chars, > 8-char min
  setUserPassword(userId, temp);
  deleteUserSessions(userId);
  unlockUser(userId);
  return temp;
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
      `SELECT u.id, u.email, u.name, u.is_admin, u.email_verified, u.created_at FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ?`
    )
    .get(sha256(token), Date.now()) as User | undefined;
  return row;
}

// ---------- email flows: password reset + verification ----------

/** Email features are active only when Resend is configured. */
export const emailEnabled = () => Boolean(process.env.RESEND_API_KEY);

/** "Sign in with Google" is active only when Google OAuth creds are configured. */
export const googleEnabled = () =>
  Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

/**
 * Create an account for an OAuth sign-in (Google): stores a random password so
 * nothing can log in by password, and marks email verified (the provider
 * already authenticated it).
 */
export function createOAuthUser(email: string, name: string): User {
  const randomPassword = crypto.randomBytes(24).toString("base64url");
  const user = createUser(email, name || email.split("@")[0], randomPassword);
  setEmailVerified(user.id);
  // Mark as a Google account: no usable password, signs in only via Google — so
  // admin password-reset is blocked for it (nothing to reset).
  db.prepare("UPDATE users SET auth_provider = 'google' WHERE id = ?").run(user.id);
  return { ...user, email_verified: 1 };
}

type TokenKind = "reset" | "verify";
const TOKEN_TTL: Record<TokenKind, number> = {
  reset: 60 * 60 * 1000,
  verify: 24 * 60 * 60 * 1000,
};

export function createAuthToken(userId: string, kind: TokenKind): string {
  const token = crypto.randomBytes(32).toString("base64url");
  db.prepare(
    "INSERT INTO auth_tokens (token_hash, user_id, kind, expires_at, created_at) VALUES (?, ?, ?, ?, ?)"
  ).run(sha256(token), userId, kind, Date.now() + TOKEN_TTL[kind], Date.now());
  return token;
}

export function consumeAuthToken(token: string, kind: TokenKind): string | null {
  if (!token) return null;
  const row = db
    .prepare(
      "SELECT user_id FROM auth_tokens WHERE token_hash = ? AND kind = ? AND expires_at > ?"
    )
    .get(sha256(token), kind, Date.now()) as { user_id?: string } | undefined;
  const userId = row?.user_id;
  if (userId) db.prepare("DELETE FROM auth_tokens WHERE token_hash = ?").run(sha256(token));
  return userId ?? null;
}

export function setUserPassword(userId: string, password: string) {
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(password), userId);
}

export function deleteUserSessions(userId: string) {
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}

export function setEmailVerified(userId: string) {
  db.prepare("UPDATE users SET email_verified = 1 WHERE id = ?").run(userId);
}

/**
 * Housekeeping: delete expired sessions and single-use tokens. Called from the
 * scheduler tick so these tables don't grow unbounded (only logout/consume
 * delete rows otherwise). Self-limiting — once it runs regularly the tables
 * stay small, so the sweep stays cheap even without an index on expires_at.
 */
export function purgeExpiredAuth(): void {
  const now = Date.now();
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(now);
  db.prepare("DELETE FROM auth_tokens WHERE expires_at < ?").run(now);
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
      email_verified: 1,
      created_at: 0,
    };
  }
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return getUserByToken(token) ?? null;
}

export const unauthorized = () =>
  Response.json({ error: "Sign in required" }, { status: 401 });
