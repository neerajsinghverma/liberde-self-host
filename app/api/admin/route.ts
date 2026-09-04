import { NextRequest } from "next/server";
import { getRequestUser, unlockUser, adminResetPassword } from "@/lib/auth";
import { db, getSetting, setSetting } from "@/lib/db";
import { audit } from "@/lib/audit";

const forbidden = () => Response.json({ error: "Admins only" }, { status: 403 });

async function requireAdmin() {
  const user = await getRequestUser();
  if (!user || !user.is_admin) return null;
  return user;
}

export async function GET(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return forbidden();
  const sp = req.nextUrl.searchParams;
  const search = (sp.get("q") || "").trim().toLowerCase();
  const pageSize = Math.min(50, Math.max(1, parseInt(sp.get("pageSize") || "8", 10) || 8));
  const page = Math.max(0, parseInt(sp.get("page") || "0", 10) || 0);
  // Server-side search + pagination so the panel scales to thousands of users
  // (only one page is returned). `search` is parameterized; page/size are clamped ints.
  const where = search ? "WHERE lower(email) LIKE ? OR lower(name) LIKE ?" : "";
  const like = `%${search}%`;
  const total = (
    db.prepare(`SELECT COUNT(*) AS n FROM users ${where}`).get(...(search ? [like, like] : [])) as {
      n: number;
    }
  ).n;
  const users = db
    .prepare(
      `SELECT id, email, name, is_admin, created_at, locked_until, auth_provider
       FROM users ${where} ORDER BY created_at ASC LIMIT ? OFFSET ?`
    )
    .all(...(search ? [like, like, pageSize, page * pageSize] : [pageSize, page * pageSize]));
  return Response.json({
    users,
    total,
    page,
    pageSize,
    allowSignups: getSetting("allow_signups", "global") !== "0",
    me: admin.id,
  });
}

export async function PATCH(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return forbidden();
  const body = await req.json();
  if (typeof body.allowSignups === "boolean") {
    setSetting("allow_signups", body.allowSignups ? "1" : "0", "global");
    await audit({
      action: "admin.signups_toggled",
      userId: admin.id,
      detail: { allowSignups: body.allowSignups },
    });
  }
  if (body.userId && typeof body.isAdmin === "boolean") {
    if (body.userId === admin.id && !body.isAdmin) {
      return Response.json({ error: "You can't demote yourself" }, { status: 400 });
    }
    db.prepare("UPDATE users SET is_admin = ? WHERE id = ?").run(
      body.isAdmin ? 1 : 0,
      body.userId
    );
  }
  // Clear a brute-force lockout so the user can sign in again immediately.
  if (body.unlockUserId) {
    unlockUser(String(body.unlockUserId));
    await audit({
      action: "admin.user_unlocked",
      userId: admin.id,
      targetType: "user",
      targetId: String(body.unlockUserId),
    });
  }
  // Admin-initiated password reset: returns a one-time temp password to relay.
  // Blocked for Google accounts — they have no password and sign in via Google.
  if (body.resetUserId) {
    const prov = (
      db.prepare("SELECT auth_provider FROM users WHERE id = ?").get(String(body.resetUserId)) as
        | { auth_provider?: string }
        | undefined
    )?.auth_provider;
    if (prov === "google") {
      return Response.json(
        { error: "This is a Google sign-in account — it has no password to reset." },
        { status: 400 }
      );
    }
    const tempPassword = adminResetPassword(String(body.resetUserId));
    await audit({
      action: "admin.password_reset",
      userId: admin.id,
      targetType: "user",
      targetId: String(body.resetUserId),
    });
    return Response.json({ ok: true, tempPassword });
  }
  // The client refetches its current page after any mutation.
  return Response.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return forbidden();
  const userId = req.nextUrl.searchParams.get("userId");
  if (!userId) return Response.json({ error: "userId is required" }, { status: 400 });
  if (userId === admin.id) {
    return Response.json({ error: "You can't delete yourself" }, { status: 400 });
  }
  // Remove the account and everything it owns.
  const convIds = db
    .prepare("SELECT id FROM conversations WHERE user_id = ?")
    .all(userId) as { id: string }[];
  for (const { id } of convIds) {
    db.prepare("DELETE FROM artifact_shares WHERE artifact_id IN (SELECT id FROM artifacts WHERE conversation_id = ?)").run(id);
    db.prepare("DELETE FROM artifact_versions WHERE artifact_id IN (SELECT id FROM artifacts WHERE conversation_id = ?)").run(id);
    db.prepare("DELETE FROM artifacts WHERE conversation_id = ?").run(id);
    db.prepare("DELETE FROM branches WHERE conversation_id = ?").run(id);
    db.prepare("DELETE FROM messages WHERE conversation_id = ?").run(id);
  }
  // Shares of the deleted user's design systems (before the systems themselves).
  db.prepare(
    "DELETE FROM design_system_shares WHERE design_system_id IN (SELECT id FROM design_systems WHERE user_id = ?)"
  ).run(userId);
  // Every table with a user_id column. http_tools notably holds a plaintext
  // auth_secret, so leaving it orphaned would keep the user's API keys at rest
  // after account deletion. design_system_shares/artifact_shares rows here are
  // the ones where this user was a RECIPIENT.
  for (const table of [
    "conversations",
    "projects",
    "memories",
    "skills",
    "connectors",
    "scheduled_tasks",
    "api_keys",
    "shared_chats",
    "providers",
    "settings",
    "sessions",
    "http_tools",
    "design_systems",
    "design_system_shares",
    "artifact_shares",
    "prompts",
    "generated_images",
    "push_subscriptions",
    "auth_tokens",
  ]) {
    db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(userId);
  }
  db.prepare("DELETE FROM project_members WHERE user_id = ?").run(userId);
  db.prepare("DELETE FROM users WHERE id = ?").run(userId);
  // audit_log is deliberately absent from the sweep above: erasing a deleted
  // user's trail is exactly what the trail exists to make impossible, and
  // removing rows would break the hash chain for everyone after them.
  await audit({
    action: "user.deleted",
    userId: admin.id,
    targetType: "user",
    targetId: userId,
  });
  return Response.json({ ok: true });
}
