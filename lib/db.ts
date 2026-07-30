import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { encryptSecret, decryptSecret } from "./crypto-secrets";
import type {
  AgentRun,
  AgentStep,
  Attachment,
  Conversation,
  DesignSystem,
  HttpTool,
  HttpToolAuth,
  HttpToolParam,
  Message,
  Project,
  ProjectFile,
} from "./types";

// ---- At-rest secret encryption (AES-256-GCM, key in env; see crypto-secrets) ----
// Settings whose value is a secret and must be encrypted before it hits the DB.
const SECRET_SETTING_KEYS = new Set(["openrouter_api_key"]);
// Provider-config fields that hold secrets.
const SECRET_CONFIG_FIELDS = ["apiKey", "secretAccessKey", "secretKey", "token"];

/** Encrypt the secret fields inside a provider config JSON string. */
function encProviderConfig(configStr: string): string {
  try {
    const c = JSON.parse(configStr) as Record<string, unknown>;
    for (const f of SECRET_CONFIG_FIELDS)
      if (typeof c[f] === "string" && c[f]) c[f] = encryptSecret(c[f] as string);
    return JSON.stringify(c);
  } catch {
    return configStr;
  }
}
/** Decrypt the secret fields inside a provider config JSON string. */
function decProviderConfig(configStr: string | null): string | null {
  if (!configStr) return configStr;
  try {
    const c = JSON.parse(configStr) as Record<string, unknown>;
    for (const f of SECRET_CONFIG_FIELDS)
      if (typeof c[f] === "string" && c[f]) c[f] = decryptSecret(c[f] as string);
    return JSON.stringify(c);
  } catch {
    return configStr;
  }
}

const DATA_DIR = path.join(process.cwd(), "data");

function createDb(): Database.Database {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new Database(path.join(DATA_DIR, "liberde.db"));
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      is_admin INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      instructions TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS project_files (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'New chat',
      model TEXT NOT NULL,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      model TEXT,
      attachments TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_messages_conversation
      ON messages(conversation_id, created_at);
    CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      identifier TEXT NOT NULL,
      type TEXT NOT NULL,
      language TEXT,
      title TEXT NOT NULL,
      share_id TEXT UNIQUE,
      share_mode TEXT,
      pinned_version INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(conversation_id, identifier)
    );
    CREATE TABLE IF NOT EXISTS artifact_versions (
      id TEXT PRIMARY KEY,
      artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      content TEXT NOT NULL,
      message_id TEXT,
      created_at INTEGER NOT NULL,
      UNIQUE(artifact_id, version)
    );
    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      key_hash TEXT NOT NULL UNIQUE,
      key_prefix TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_used_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS shared_chats (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      title TEXT NOT NULL,
      snapshot TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL,
      instructions TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS prompts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      body TEXT NOT NULL,
      user_id TEXT NOT NULL DEFAULT 'local',
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS project_members (
      project_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      added_at INTEGER NOT NULL,
      PRIMARY KEY (project_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS providers (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'local',
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      config TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS connectors (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      transport TEXT NOT NULL,
      command TEXT,
      args TEXT,
      url TEXT,
      headers TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS http_tools (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'local',
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      method TEXT NOT NULL DEFAULT 'GET',
      url_template TEXT NOT NULL,
      params TEXT NOT NULL DEFAULT '[]',
      headers TEXT NOT NULL DEFAULT '{}',
      auth TEXT NOT NULL DEFAULT '{"type":"none"}',
      auth_secret TEXT,
      body_mode TEXT NOT NULL DEFAULT 'auto',
      body_template TEXT,
      response_extract TEXT,
      max_response_bytes INTEGER NOT NULL DEFAULT 24576,
      auto_run INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'manual',
      openapi_group TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_http_tools_user ON http_tools(user_id);
    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      prompt TEXT NOT NULL,
      schedule_kind TEXT NOT NULL,
      interval_minutes INTEGER,
      daily_time TEXT,
      web_search INTEGER NOT NULL DEFAULT 0,
      model TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      next_run INTEGER NOT NULL,
      last_run INTEGER,
      last_conversation_id TEXT,
      last_error TEXT,
      created_at INTEGER NOT NULL
    );
  `);

  // Multi-user: rebuild settings around a (user_id, key) composite key.
  const settingsCols = db.prepare("PRAGMA table_info(settings)").all() as {
    name: string;
  }[];
  if (!settingsCols.some((c) => c.name === "user_id")) {
    db.exec(`
      CREATE TABLE settings_v2 (
        user_id TEXT NOT NULL DEFAULT 'local',
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        PRIMARY KEY (user_id, key)
      );
      INSERT INTO settings_v2 (user_id, key, value) SELECT 'local', key, value FROM settings;
      DROP TABLE settings;
      ALTER TABLE settings_v2 RENAME TO settings;
    `);
  }

  // Every user-owned table carries user_id ('local' = pre-account single-user data).
  for (const table of [
    "conversations",
    "projects",
    "memories",
    "skills",
    "connectors",
    "scheduled_tasks",
    "api_keys",
    "shared_chats",
  ]) {
    ensureColumn(db, table, "user_id", "TEXT NOT NULL DEFAULT 'local'");
  }

  // Additive migrations for databases created by earlier versions.
  ensureColumn(db, "messages", "reasoning", "TEXT");
  ensureColumn(db, "messages", "annotations", "TEXT");
  ensureColumn(db, "messages", "images", "TEXT");
  ensureColumn(db, "messages", "tool_calls", "TEXT");
  ensureColumn(db, "messages", "tool_call_id", "TEXT");
  ensureColumn(db, "conversations", "is_temp", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "conversations", "starred", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "conversations", "archived", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "messages", "reasoning_ms", "INTEGER");
  ensureColumn(db, "messages", "cost", "REAL");
  ensureColumn(db, "messages", "tokens_in", "INTEGER");
  ensureColumn(db, "messages", "tokens_out", "INTEGER");
  ensureColumn(db, "connectors", "oauth_data", "TEXT");
  ensureColumn(db, "connectors", "tools_cache", "TEXT");
  ensureColumn(db, "connectors", "last_tested", "INTEGER");
  ensureColumn(db, "skills", "connector_ids", "TEXT");
  ensureColumn(db, "skills", "http_tool_ids", "TEXT");
  ensureColumn(db, "conversations", "locked_at", "INTEGER");
  ensureColumn(db, "conversations", "mode", "TEXT NOT NULL DEFAULT 'chat'");
  db.exec(`
    CREATE TABLE IF NOT EXISTS branches (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      anchor_id TEXT NOT NULL,
      snapshot TEXT NOT NULL,
      preview TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS agent_runs (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      user_id TEXT NOT NULL DEFAULT 'local',
      goal TEXT NOT NULL,
      model TEXT NOT NULL,
      planner_model TEXT NOT NULL DEFAULT '',
      exec_model TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'running',
      steps TEXT NOT NULL DEFAULT '[]',
      current_step INTEGER NOT NULL DEFAULT 0,
      notes TEXT NOT NULL DEFAULT '[]',
      run_msg_id TEXT,
      total_cost REAL NOT NULL DEFAULT 0,
      context_block TEXT NOT NULL DEFAULT '',
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_agent_runs_status ON agent_runs(status, updated_at);
    CREATE TABLE IF NOT EXISTS generated_images (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'local',
      mime TEXT NOT NULL DEFAULT 'image/png',
      data TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      endpoint TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'local',
      subscription TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
  // Design systems: named brand specs applied to Design-mode builds, plus
  // user-to-user shares for systems and artifacts (project_members pattern).
  db.exec(`
    CREATE TABLE IF NOT EXISTS design_systems (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'local',
      name TEXT NOT NULL,
      spec TEXT NOT NULL,
      palette TEXT,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS design_system_shares (
      design_system_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      added_at INTEGER NOT NULL,
      PRIMARY KEY (design_system_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS artifact_shares (
      artifact_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      added_at INTEGER NOT NULL,
      PRIMARY KEY (artifact_id, user_id)
    );
  `);
  ensureColumn(db, "conversations", "design_system_id", "TEXT");
  // Cost attribution: JSON {"model":n,"search":n,"image":n} per assistant turn.
  ensureColumn(db, "messages", "cost_breakdown", "TEXT");
  // Wall-clock generation time per assistant turn (footer: cost · tok · ms).
  ensureColumn(db, "messages", "duration_ms", "INTEGER");
  // Auto routing: the reason the router picked this turn's model (footer badge).
  ensureColumn(db, "messages", "route_reason", "TEXT");
  // Email flows: hashed password-reset / verify tokens + per-user verified flag.
  db.exec(`
    CREATE TABLE IF NOT EXISTS auth_tokens (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
  ensureColumn(db, "users", "email_verified", "INTEGER NOT NULL DEFAULT 0");
  // Brute-force lockout: consecutive failed logins + a temporary lock timestamp.
  ensureColumn(db, "users", "failed_logins", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "users", "locked_until", "INTEGER NOT NULL DEFAULT 0");
  // Sign-in method: 'password' or 'google' (OAuth accounts have no password).
  ensureColumn(db, "users", "auth_provider", "TEXT NOT NULL DEFAULT 'password'");

  // Indexes for per-user / per-parent lookups. All referenced tables + columns
  // exist by now; each guarded so one failure can't wedge startup.
  for (const stmt of [
    "CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id, updated_at)",
    "CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_project_files_project ON project_files(project_id)",
    "CREATE INDEX IF NOT EXISTS idx_memories_user ON memories(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_skills_user ON skills(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_prompts_user ON prompts(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_connectors_user ON connectors(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_providers_user ON providers(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_shared_chats_user ON shared_chats(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_branches_conversation ON branches(conversation_id)",
    "CREATE INDEX IF NOT EXISTS idx_artifacts_conversation ON artifacts(conversation_id)",
    "CREATE INDEX IF NOT EXISTS idx_artifact_versions_artifact ON artifact_versions(artifact_id)",
    "CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_due ON scheduled_tasks(enabled, next_run)",
    // Both queried WHERE user_id but their PKs are endpoint/id.
    "CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_user ON scheduled_tasks(user_id)",
  ]) {
    try {
      db.exec(stmt);
    } catch {
      /* non-fatal */
    }
  }

  // One-time grandfather: accounts predating email verification stay verified
  // (guarded by a marker so future unverified signups are still gated).
  try {
    const done = db
      .prepare("SELECT 1 FROM settings WHERE user_id = 'global' AND key = 'email_verify_backfill' LIMIT 1")
      .get();
    if (!done) {
      db.exec("UPDATE users SET email_verified = 1");
      db.prepare(
        "INSERT OR IGNORE INTO settings (user_id, key, value) VALUES ('global', 'email_verify_backfill', '1')"
      ).run();
    }
  } catch {
    /* non-fatal */
  }

  // Temporary chats are ephemeral by contract: purge stale ones on boot.
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const staleTmp = db
    .prepare("SELECT id FROM conversations WHERE is_temp = 1 AND updated_at < ?")
    .all(dayAgo) as { id: string }[];
  for (const { id } of staleTmp) {
    db.prepare("DELETE FROM artifact_versions WHERE artifact_id IN (SELECT id FROM artifacts WHERE conversation_id = ?)").run(id);
    db.prepare("DELETE FROM artifacts WHERE conversation_id = ?").run(id);
    db.prepare("DELETE FROM messages WHERE conversation_id = ?").run(id);
    db.prepare("DELETE FROM conversations WHERE id = ?").run(id);
  }

  return db;
}

function ensureColumn(
  db: Database.Database,
  table: string,
  column: string,
  ddl: string
) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  }
}

// Survive Next.js dev-server hot reloads without leaking connections.
const globalForDb = globalThis as unknown as { __liberdeDb?: Database.Database };
export const db = globalForDb.__liberdeDb ?? createDb();
globalForDb.__liberdeDb = db;

export const newId = () => crypto.randomUUID();
const now = () => Date.now();

// ---------- per-conversation generation lock ----------
// One in-flight generation per conversation: overlapping streams would
// interleave assistant/tool messages and corrupt the replayable history.
// Backed by a `conversations.locked_at` timestamp so a crashed/timed-out run
// self-heals: a lock older than the TTL is stale and can be re-acquired.
const LOCK_TTL_MS = 6 * 60 * 1000;

export function tryLockConversation(id: string): boolean {
  const nowTs = Date.now();
  const stale = nowTs - LOCK_TTL_MS;
  const res = db
    .prepare(
      `UPDATE conversations SET locked_at = ?
       WHERE id = ? AND (locked_at IS NULL OR locked_at < ?)`
    )
    .run(nowTs, id, stale);
  return res.changes > 0;
}

export function unlockConversation(id: string) {
  db.prepare("UPDATE conversations SET locked_at = NULL WHERE id = ?").run(id);
}

// ---------- settings ----------

export const DEFAULT_USER = "local";

export function getSetting(key: string, userId: string = DEFAULT_USER): string | null {
  const row = db
    .prepare("SELECT value FROM settings WHERE user_id = ? AND key = ?")
    .get(userId, key) as { value: string } | undefined;
  const val = row?.value ?? null;
  return SECRET_SETTING_KEYS.has(key) ? decryptSecret(val) : val;
}

export function setSetting(key: string, value: string, userId: string = DEFAULT_USER) {
  const toStore = SECRET_SETTING_KEYS.has(key) ? encryptSecret(value) : value;
  db.prepare(
    "INSERT INTO settings (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value"
  ).run(userId, key, toStore);
}

export function getApiKey(userId: string = DEFAULT_USER): string {
  const own = getSetting("openrouter_api_key", userId);
  if (own) return own;
  // The shared OPENROUTER_API_KEY env fallback is allowed ONLY for a
  // single-user/local install (no auth). Any multi-user or public deploy
  // (Vercel, or REQUIRE_AUTH set) is strictly per-user — never let one user
  // (or the operator's key) be spent by anyone else.
  const multiUser = Boolean(process.env.REQUIRE_AUTH ?? process.env.VERCEL);
  return multiUser ? "" : process.env.OPENROUTER_API_KEY || "";
}

// ---------- conversations ----------

export function listConversations(
  userId: string = DEFAULT_USER,
  mode: string = "chat"
): Conversation[] {
  return db
    .prepare(
      "SELECT * FROM conversations WHERE user_id = ? AND is_temp = 0 AND archived = 0 AND mode = ? ORDER BY updated_at DESC"
    )
    .all(userId, mode) as Conversation[];
}

export function listArchivedConversations(userId: string = DEFAULT_USER): Conversation[] {
  return db
    .prepare(
      "SELECT * FROM conversations WHERE user_id = ? AND is_temp = 0 AND archived = 1 ORDER BY updated_at DESC"
    )
    .all(userId) as Conversation[];
}

/** Unified search: conversations, projects (incl. knowledge files), artifacts. */
export interface UsageStats {
  total: { cost: number; tokensIn: number; tokensOut: number; messages: number };
  byModel: { model: string; n: number; cost: number; tin: number; tout: number }[];
  byDay: { day: number; cost: number; n: number }[];
  /** Spend by category: model | search | image (from per-message breakdowns). */
  byCategory: Record<string, number>;
}

/** Aggregate this user's assistant-message spend for the usage dashboard. */
export function usageStats(userId: string = DEFAULT_USER): UsageStats {
  const byModel = db
    .prepare(
      `SELECT m.model AS model, COUNT(*) AS n, COALESCE(SUM(m.cost),0) AS cost,
              COALESCE(SUM(m.tokens_in),0) AS tin, COALESCE(SUM(m.tokens_out),0) AS tout
       FROM messages m JOIN conversations c ON c.id = m.conversation_id
       WHERE c.user_id = ? AND m.role = 'assistant'
       GROUP BY m.model ORDER BY cost DESC`
    )
    .all(userId) as { model: string; n: number; cost: number; tin: number; tout: number }[];
  const since = Date.now() - 30 * 86_400_000;
  const byDay = db
    .prepare(
      `SELECT CAST(m.created_at / 86400000 AS INTEGER) AS day, COALESCE(SUM(m.cost),0) AS cost, COUNT(*) AS n
       FROM messages m JOIN conversations c ON c.id = m.conversation_id
       WHERE c.user_id = ? AND m.role = 'assistant' AND m.created_at > ?
       GROUP BY day ORDER BY day`
    )
    .all(userId, since) as { day: number; cost: number; n: number }[];
  const total = byModel.reduce(
    (a, r) => ({
      cost: a.cost + (r.cost || 0),
      tokensIn: a.tokensIn + (r.tin || 0),
      tokensOut: a.tokensOut + (r.tout || 0),
      messages: a.messages + (r.n || 0),
    }),
    { cost: 0, tokensIn: 0, tokensOut: 0, messages: 0 }
  );
  // Where the money goes: sum per-message cost_breakdown JSON. Messages from
  // before attribution existed (no breakdown) count as plain model spend.
  const bdRows = db
    .prepare(
      `SELECT m.cost AS cost, m.cost_breakdown AS cost_breakdown FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE c.user_id = ? AND m.role = 'assistant' AND m.cost > 0`
    )
    .all(userId) as { cost: number; cost_breakdown: string | null }[];
  const byCategory: Record<string, number> = {};
  for (const r of bdRows) {
    let bd: Record<string, number> | null = null;
    try {
      bd = r.cost_breakdown ? JSON.parse(r.cost_breakdown) : null;
    } catch {
      bd = null;
    }
    if (bd && typeof bd === "object") {
      for (const [k, v] of Object.entries(bd)) {
        if (typeof v === "number" && v > 0) byCategory[k] = (byCategory[k] ?? 0) + v;
      }
    } else {
      byCategory.model = (byCategory.model ?? 0) + (r.cost || 0);
    }
  }
  return {
    total,
    byModel: byModel.map((r) => ({ ...r, model: r.model || "unknown" })),
    byDay,
    byCategory,
  };
}

export interface PromptRecord {
  id: string;
  name: string;
  slug: string;
  body: string;
  user_id: string;
  created_at: number;
}

export function listPrompts(userId: string = DEFAULT_USER): PromptRecord[] {
  return db
    .prepare("SELECT * FROM prompts WHERE user_id = ? ORDER BY created_at DESC")
    .all(userId) as PromptRecord[];
}

export function createPrompt(
  input: { name: string; body: string },
  userId: string = DEFAULT_USER
): PromptRecord {
  const slug =
    input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) ||
    "prompt";
  const rec = { id: newId(), name: input.name, slug, body: input.body, user_id: userId, created_at: now() };
  db.prepare(
    "INSERT INTO prompts (id, name, slug, body, user_id, created_at) VALUES (@id, @name, @slug, @body, @user_id, @created_at)"
  ).run(rec);
  return rec as PromptRecord;
}

export function deletePrompt(id: string, userId: string = DEFAULT_USER) {
  db.prepare("DELETE FROM prompts WHERE id = ? AND user_id = ?").run(id, userId);
}

/** Month-to-date assistant spend for this user, for budget enforcement. */
export function spendThisMonth(userId: string = DEFAULT_USER): number {
  const d = new Date();
  const monthStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(m.cost),0) AS cost FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE c.user_id = ? AND m.role = 'assistant' AND m.created_at >= ?`
    )
    .get(userId, monthStart) as { cost: number };
  return Number(row?.cost) || 0;
}

export function searchAll(query: string, userId: string = DEFAULT_USER): {
  conversations: Conversation[];
  projects: Project[];
  artifacts: { id: string; conversation_id: string; identifier: string; title: string; type: string }[];
} {
  const like = `%${query.replace(/[%_]/g, "\\$&")}%`;
  const projects = db
    .prepare(
      `SELECT DISTINCT p.* FROM projects p
       LEFT JOIN project_files f ON f.project_id = p.id
       WHERE p.user_id = ? AND (p.name LIKE ? ESCAPE '\\' OR p.instructions LIKE ? ESCAPE '\\'
         OR f.name LIKE ? ESCAPE '\\' OR f.content LIKE ? ESCAPE '\\')
       ORDER BY p.created_at DESC LIMIT 10`
    )
    .all(userId, like, like, like, like) as Project[];
  const artifacts = db
    .prepare(
      `SELECT DISTINCT a.id, a.conversation_id, a.identifier, a.title, a.type
       FROM artifacts a
       JOIN conversations c ON c.id = a.conversation_id
       LEFT JOIN artifact_versions v ON v.artifact_id = a.id
       WHERE c.user_id = ? AND (a.title LIKE ? ESCAPE '\\' OR a.identifier LIKE ? ESCAPE '\\'
         OR v.content LIKE ? ESCAPE '\\')
       ORDER BY a.updated_at DESC LIMIT 10`
    )
    .all(userId, like, like, like) as {
    id: string;
    conversation_id: string;
    identifier: string;
    title: string;
    type: string;
  }[];
  return { conversations: searchConversations(query, userId), projects, artifacts };
}

export interface RecallHit {
  conversation_id: string;
  title: string;
  role: string;
  content: string;
  created_at: number;
}

/** Recall: find message excerpts across the user's past (non-temp) chats that
 *  match a query — used by the model-callable "search_past_chats" tool. */
export function searchPastMessages(
  query: string,
  userId: string = DEFAULT_USER,
  limit = 8
): RecallHit[] {
  const like = `%${query.replace(/[%_]/g, "\\$&")}%`;
  return db
    .prepare(
      `SELECT c.id AS conversation_id, c.title AS title, m.role AS role,
              m.content AS content, m.created_at AS created_at
       FROM messages m JOIN conversations c ON c.id = m.conversation_id
       WHERE c.user_id = ? AND c.is_temp = 0 AND m.role IN ('user','assistant')
         AND m.content LIKE ? ESCAPE '\\'
       ORDER BY m.created_at DESC LIMIT ?`
    )
    .all(userId, like, limit) as RecallHit[];
}

/** Full-text search across conversation titles and message content. */
export function searchConversations(
  query: string,
  userId: string = DEFAULT_USER
): Conversation[] {
  const like = `%${query.replace(/[%_]/g, "\\$&")}%`;
  return db
    .prepare(
      `SELECT DISTINCT c.* FROM conversations c
       LEFT JOIN messages m ON m.conversation_id = c.id
       WHERE c.user_id = ? AND c.is_temp = 0 AND (c.title LIKE ? ESCAPE '\\' OR m.content LIKE ? ESCAPE '\\')
       ORDER BY c.updated_at DESC LIMIT 50`
    )
    .all(userId, like, like) as Conversation[];
}

export function getConversation(id: string): Conversation | undefined {
  return db.prepare("SELECT * FROM conversations WHERE id = ?").get(id) as
    | Conversation
    | undefined;
}

export function createConversation(
  model: string,
  projectId: string | null = null,
  isTemp = false,
  userId: string = DEFAULT_USER,
  mode: string = "chat"
): Conversation {
  const conv: Conversation = {
    id: newId(),
    title: isTemp ? "Temporary chat" : "New chat",
    model,
    project_id: projectId,
    is_temp: isTemp ? 1 : 0,
    user_id: userId,
    mode,
    created_at: now(),
    updated_at: now(),
  };
  db.prepare(
    "INSERT INTO conversations (id, title, model, project_id, is_temp, user_id, mode, created_at, updated_at) VALUES (@id, @title, @model, @project_id, @is_temp, @user_id, @mode, @created_at, @updated_at)"
  ).run(conv);
  return conv;
}

export function updateConversation(
  id: string,
  fields: Partial<
    Pick<
      Conversation,
      "title" | "model" | "project_id" | "starred" | "archived" | "design_system_id"
    >
  >
) {
  const conv = getConversation(id);
  if (!conv) return;
  const merged = {
    starred: 0,
    archived: 0,
    design_system_id: null as string | null,
    ...conv,
    ...fields,
    updated_at: now(),
  };
  db.prepare(
    "UPDATE conversations SET title = @title, model = @model, project_id = @project_id, starred = @starred, archived = @archived, design_system_id = @design_system_id, updated_at = @updated_at WHERE id = @id"
  ).run(merged);
}

export function touchConversation(id: string) {
  db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(now(), id);
}

export function deleteConversation(id: string) {
  deleteArtifactsForConversation(id);
  deleteSharedChatsFor(id);
  deleteBranchesFor(id);
  db.prepare("DELETE FROM messages WHERE conversation_id = ?").run(id);
  db.prepare("DELETE FROM conversations WHERE id = ?").run(id);
}

// ---------- messages ----------

function rowToMessage(row: Record<string, unknown>): Message {
  return {
    ...(row as unknown as Message),
    attachments: row.attachments ? JSON.parse(row.attachments as string) : null,
    annotations: row.annotations ? JSON.parse(row.annotations as string) : null,
    images: row.images ? JSON.parse(row.images as string) : null,
    tool_calls: row.tool_calls ? JSON.parse(row.tool_calls as string) : null,
  };
}

export function listMessages(conversationId: string): Message[] {
  const rows = db
    .prepare(
      "SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC, rowid ASC"
    )
    .all(conversationId) as Record<string, unknown>[];
  return rows.map(rowToMessage);
}

/** Concrete model of the most recent assistant turn — used for Auto stickiness. */
export function getLastAssistantModel(conversationId: string): string | null {
  const row = db
    .prepare(
      "SELECT model FROM messages WHERE conversation_id = ? AND role = 'assistant' AND model IS NOT NULL AND model <> 'auto' ORDER BY created_at DESC, rowid DESC LIMIT 1"
    )
    .get(conversationId) as { model?: string } | undefined;
  return row?.model ?? null;
}

export function addMessage(
  conversationId: string,
  role: Message["role"],
  content: string,
  model: string | null = null,
  attachments: Attachment[] | null = null,
  extras: {
    reasoning?: string | null;
    annotations?: unknown[] | null;
    images?: string[] | null;
    tool_calls?: unknown[] | null;
    tool_call_id?: string | null;
    reasoning_ms?: number | null;
    cost?: number | null;
    tokens_in?: number | null;
    tokens_out?: number | null;
    cost_breakdown?: string | null;
    duration_ms?: number | null;
    route_reason?: string | null;
  } = {}
): Message {
  const msg: Message = {
    id: newId(),
    conversation_id: conversationId,
    role,
    content,
    model,
    attachments,
    reasoning: extras.reasoning ?? null,
    annotations: (extras.annotations as Message["annotations"]) ?? null,
    images: extras.images ?? null,
    tool_calls: extras.tool_calls ?? null,
    tool_call_id: extras.tool_call_id ?? null,
    reasoning_ms: extras.reasoning_ms ?? null,
    cost: extras.cost ?? null,
    tokens_in: extras.tokens_in ?? null,
    tokens_out: extras.tokens_out ?? null,
    cost_breakdown: extras.cost_breakdown ?? null,
    duration_ms: extras.duration_ms ?? null,
    route_reason: extras.route_reason ?? null,
    created_at: now(),
  };
  db.prepare(
    "INSERT INTO messages (id, conversation_id, role, content, model, attachments, reasoning, annotations, images, tool_calls, tool_call_id, reasoning_ms, cost, tokens_in, tokens_out, cost_breakdown, duration_ms, route_reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(
    msg.id,
    msg.conversation_id,
    msg.role,
    msg.content,
    msg.model,
    attachments ? JSON.stringify(attachments) : null,
    msg.reasoning,
    msg.annotations ? JSON.stringify(msg.annotations) : null,
    msg.images ? JSON.stringify(msg.images) : null,
    msg.tool_calls ? JSON.stringify(msg.tool_calls) : null,
    msg.tool_call_id,
    msg.reasoning_ms,
    msg.cost,
    msg.tokens_in,
    msg.tokens_out,
    msg.cost_breakdown,
    msg.duration_ms,
    msg.route_reason,
    msg.created_at
  );
  touchConversation(conversationId);
  return msg;
}

export function saveGeneratedImage(userId: string, mime: string, base64: string): string {
  const id = newId();
  db.prepare(
    "INSERT INTO generated_images (id, user_id, mime, data, created_at) VALUES (?, ?, ?, ?, ?)"
  ).run(id, userId, mime, base64, now());
  return id;
}

export function getGeneratedImage(id: string): { mime: string; data: string } | undefined {
  return db.prepare("SELECT mime, data FROM generated_images WHERE id = ?").get(id) as
    | { mime: string; data: string }
    | undefined;
}

export function updateMessageContent(id: string, content: string) {
  db.prepare("UPDATE messages SET content = ? WHERE id = ?").run(content, id);
}

/** Record the accumulated cost of a run on its checkpoint message so it counts
 *  toward monthly-budget accounting (spendThisMonth sums messages.cost). */
export function updateMessageCost(id: string, cost: number) {
  db.prepare("UPDATE messages SET cost = ? WHERE id = ?").run(cost || null, id);
}

// ---------- durable agent runs ----------

function rowToAgentRun(r: Record<string, unknown>): AgentRun {
  return {
    id: r.id as string,
    conversation_id: r.conversation_id as string,
    user_id: r.user_id as string,
    goal: r.goal as string,
    model: r.model as string,
    planner_model: (r.planner_model as string) ?? "",
    exec_model: (r.exec_model as string) ?? "",
    status: r.status as AgentRun["status"],
    steps: JSON.parse((r.steps as string) || "[]"),
    current_step: Number(r.current_step) || 0,
    notes: JSON.parse((r.notes as string) || "[]"),
    run_msg_id: (r.run_msg_id as string) ?? null,
    total_cost: Number(r.total_cost) || 0,
    context_block: (r.context_block as string) ?? "",
    error: (r.error as string) ?? null,
    created_at: Number(r.created_at),
    updated_at: Number(r.updated_at),
  };
}

export function createAgentRun(fields: {
  conversationId: string;
  userId: string;
  goal: string;
  model: string;
  plannerModel: string;
  execModel: string;
  contextBlock: string;
}): AgentRun {
  const id = newId();
  const ts = now();
  db.prepare(
    `INSERT INTO agent_runs (id, conversation_id, user_id, goal, model, planner_model, exec_model, status, steps, current_step, notes, total_cost, context_block, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'running', '[]', 0, '[]', 0, ?, ?, ?)`
  ).run(
    id,
    fields.conversationId,
    fields.userId,
    fields.goal,
    fields.model,
    fields.plannerModel,
    fields.execModel,
    fields.contextBlock,
    ts,
    ts
  );
  return rowToAgentRun(
    db.prepare("SELECT * FROM agent_runs WHERE id = ?").get(id) as Record<string, unknown>
  );
}

export function getAgentRun(id: string): AgentRun | null {
  const row = db.prepare("SELECT * FROM agent_runs WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToAgentRun(row) : null;
}

export function updateAgentRun(
  id: string,
  patch: Partial<{
    status: AgentRun["status"];
    steps: AgentStep[];
    current_step: number;
    notes: string[];
    run_msg_id: string | null;
    total_cost: number;
    error: string | null;
  }>
): void {
  const sets: string[] = [];
  const vals: unknown[] = [];
  const add = (col: string, val: unknown) => {
    sets.push(`${col} = ?`);
    vals.push(val);
  };
  if (patch.status !== undefined) add("status", patch.status);
  if (patch.steps !== undefined) add("steps", JSON.stringify(patch.steps));
  if (patch.current_step !== undefined) add("current_step", patch.current_step);
  if (patch.notes !== undefined) add("notes", JSON.stringify(patch.notes));
  if (patch.run_msg_id !== undefined) add("run_msg_id", patch.run_msg_id);
  if (patch.total_cost !== undefined) add("total_cost", patch.total_cost);
  if (patch.error !== undefined) add("error", patch.error);
  add("updated_at", now());
  vals.push(id);
  db.prepare(`UPDATE agent_runs SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
}

/** Runs still 'running' but untouched for `staleMs` — a streamer likely died. */
export function listResumableAgentRuns(staleMs: number): AgentRun[] {
  const rows = db
    .prepare(
      `SELECT * FROM agent_runs WHERE status IN ('running','synthesizing') AND updated_at < ?
       ORDER BY updated_at ASC LIMIT 20`
    )
    .all(now() - staleMs) as Record<string, unknown>[];
  return rows.map(rowToAgentRun);
}

/** Persist enriched attachments (e.g. extracted PDF text) so parsing happens once. */
export function updateMessageAttachments(id: string, attachments: Attachment[]) {
  db.prepare("UPDATE messages SET attachments = ? WHERE id = ?").run(
    JSON.stringify(attachments),
    id
  );
}

export function deleteMessagesFrom(
  conversationId: string,
  messageId: string,
  opts: { pruneArtifacts?: boolean } = {}
) {
  const target = db
    .prepare("SELECT created_at, rowid FROM messages WHERE id = ?")
    .get(messageId) as { created_at: number; rowid: number } | undefined;
  if (!target) return;
  // When the tail is preserved as a branch, its artifact versions stay too —
  // pruning is only for true deletions.
  if (opts.pruneArtifacts !== false) {
    const doomed = db
      .prepare(
        "SELECT id FROM messages WHERE conversation_id = ? AND (created_at > ? OR (created_at = ? AND rowid >= ?))"
      )
      .all(conversationId, target.created_at, target.created_at, target.rowid) as {
      id: string;
    }[];
    pruneArtifactVersionsForMessages(doomed.map((m) => m.id));
  }
  db.prepare(
    "DELETE FROM messages WHERE conversation_id = ? AND (created_at > ? OR (created_at = ? AND rowid >= ?))"
  ).run(conversationId, target.created_at, target.created_at, target.rowid);
}

/**
 * Replace all but the most recent `keepRecent` messages with a single summary
 * message, cutting context size. Artifacts are NOT pruned — they live on.
 */
export function compactConversation(
  conversationId: string,
  keepRecent: number,
  summary: string
): number {
  const all = listMessages(conversationId);
  if (all.length <= keepRecent) return 0;
  const toDelete = all.slice(0, all.length - keepRecent);
  const anchor = all[all.length - keepRecent].created_at - 1000;
  const del = db.prepare("DELETE FROM messages WHERE id = ?");
  for (const m of toDelete) del.run(m.id);
  db.prepare(
    "INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, 'assistant', ?, ?)"
  ).run(newId(), conversationId, summary, anchor);
  return toDelete.length;
}

// ---------- branches (ChatGPT-style edit/regenerate variants) ----------

export interface BranchRecord {
  id: string;
  conversation_id: string;
  anchor_id: string; // id of the message BEFORE the fork ('' = conversation start)
  snapshot: string; // JSON array of Message objects
  preview: string;
  created_at: number;
}

function tailAfterAnchor(conversationId: string, anchorId: string): Message[] {
  const all = listMessages(conversationId);
  if (!anchorId) return all;
  const idx = all.findIndex((m) => m.id === anchorId);
  return idx === -1 ? [] : all.slice(idx + 1);
}

/** Snapshot the tail starting at fromMessageId (inclusive) as a branch. */
export function snapshotTailAsBranch(
  conversationId: string,
  fromMessageId: string
): BranchRecord | null {
  const all = listMessages(conversationId);
  const idx = all.findIndex((m) => m.id === fromMessageId);
  if (idx === -1) return null;
  const tail = all.slice(idx);
  if (tail.length === 0) return null;
  const anchorId = idx > 0 ? all[idx - 1].id : "";
  const record: BranchRecord = {
    id: newId(),
    conversation_id: conversationId,
    anchor_id: anchorId,
    snapshot: JSON.stringify(tail),
    preview: tail[0].content.slice(0, 120),
    created_at: now(),
  };
  db.prepare(
    "INSERT INTO branches (id, conversation_id, anchor_id, snapshot, preview, created_at) VALUES (@id, @conversation_id, @anchor_id, @snapshot, @preview, @created_at)"
  ).run(record);
  return record;
}

export function listBranches(conversationId: string): BranchRecord[] {
  return db
    .prepare(
      "SELECT * FROM branches WHERE conversation_id = ? ORDER BY created_at ASC"
    )
    .all(conversationId) as BranchRecord[];
}

function restoreMessages(tail: Message[]) {
  const insert = db.prepare(
    "INSERT INTO messages (id, conversation_id, role, content, model, attachments, reasoning, annotations, images, tool_calls, tool_call_id, reasoning_ms, cost, tokens_in, tokens_out, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  for (const m of tail) {
    insert.run(
      m.id,
      m.conversation_id,
      m.role,
      m.content,
      m.model,
      m.attachments ? JSON.stringify(m.attachments) : null,
      m.reasoning ?? null,
      m.annotations ? JSON.stringify(m.annotations) : null,
      m.images ? JSON.stringify(m.images) : null,
      m.tool_calls ? JSON.stringify(m.tool_calls) : null,
      m.tool_call_id ?? null,
      m.reasoning_ms ?? null,
      m.cost ?? null,
      m.tokens_in ?? null,
      m.tokens_out ?? null,
      m.created_at
    );
  }
}

/**
 * Swap the live tail with a stored branch: the current tail becomes a branch
 * and the chosen branch becomes live. Returns the restored messages.
 */
export function switchToBranch(
  conversationId: string,
  branchId: string
): Message[] | null {
  const branch = db
    .prepare("SELECT * FROM branches WHERE id = ? AND conversation_id = ?")
    .get(branchId, conversationId) as BranchRecord | undefined;
  if (!branch) return null;

  const liveTail = tailAfterAnchor(conversationId, branch.anchor_id);
  if (liveTail.length > 0) {
    const record: BranchRecord = {
      id: newId(),
      conversation_id: conversationId,
      anchor_id: branch.anchor_id,
      snapshot: JSON.stringify(liveTail),
      preview: liveTail[0].content.slice(0, 120),
      // Preserve ordering: the outgoing live tail takes the incoming branch's slot age.
      created_at: branch.created_at,
    };
    db.prepare(
      "INSERT INTO branches (id, conversation_id, anchor_id, snapshot, preview, created_at) VALUES (@id, @conversation_id, @anchor_id, @snapshot, @preview, @created_at)"
    ).run(record);
    // Artifact versions survive branch swaps intentionally (full history kept).
    const del = db.prepare("DELETE FROM messages WHERE id = ?");
    for (const m of liveTail) del.run(m.id);
  }

  const restored = JSON.parse(branch.snapshot) as Message[];
  restoreMessages(restored);
  db.prepare("DELETE FROM branches WHERE id = ?").run(branchId);
  touchConversation(conversationId);
  return restored;
}

export function deleteBranchesFor(conversationId: string) {
  db.prepare("DELETE FROM branches WHERE conversation_id = ?").run(conversationId);
}

// ---------- projects ----------

/** Projects the user owns plus projects shared with them. */
export function listProjects(userId: string = DEFAULT_USER): Project[] {
  return db
    .prepare(
      `SELECT DISTINCT p.* FROM projects p
       LEFT JOIN project_members m ON m.project_id = p.id
       WHERE p.user_id = ? OR m.user_id = ?
       ORDER BY p.created_at DESC`
    )
    .all(userId, userId) as Project[];
}

export function canAccessProject(projectId: string, userId: string): boolean {
  const project = getProject(projectId);
  if (!project) return false;
  const owner = (project as Project & { user_id?: string }).user_id;
  if (!owner || owner === userId) return true;
  return Boolean(
    db
      .prepare("SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?")
      .get(projectId, userId)
  );
}

export function isProjectOwner(projectId: string, userId: string): boolean {
  const project = getProject(projectId) as (Project & { user_id?: string }) | undefined;
  return Boolean(project && (!project.user_id || project.user_id === userId));
}

export function listProjectMembers(
  projectId: string
): { user_id: string; email: string; name: string; added_at: number }[] {
  return db
    .prepare(
      `SELECT m.user_id, u.email, u.name, m.added_at FROM project_members m
       JOIN users u ON u.id = m.user_id WHERE m.project_id = ? ORDER BY m.added_at ASC`
    )
    .all(projectId) as { user_id: string; email: string; name: string; added_at: number }[];
}

export function addProjectMember(projectId: string, userId: string) {
  db.prepare(
    "INSERT OR IGNORE INTO project_members (project_id, user_id, added_at) VALUES (?, ?, ?)"
  ).run(projectId, userId, now());
}

export function removeProjectMember(projectId: string, userId: string) {
  db.prepare("DELETE FROM project_members WHERE project_id = ? AND user_id = ?").run(
    projectId,
    userId
  );
}

// ---------------------------------------------------------------------------
// Design systems — named brand specs applied to Design-mode builds. A user can
// have many; at most one is the default. Shares follow the project_members
// pattern: recipients get read-only access (they can apply or copy, not edit).

export function createDesignSystem(
  userId: string,
  data: { name: string; spec: string; palette?: string | null; isDefault?: boolean }
): DesignSystem {
  const ds: DesignSystem = {
    id: newId(),
    user_id: userId,
    name: data.name,
    spec: data.spec,
    palette: data.palette ?? null,
    is_default: data.isDefault ? 1 : 0,
    created_at: now(),
    updated_at: now(),
  };
  if (data.isDefault) {
    db.prepare("UPDATE design_systems SET is_default = 0 WHERE user_id = ?").run(userId);
  }
  db.prepare(
    `INSERT INTO design_systems (id, user_id, name, spec, palette, is_default, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(ds.id, ds.user_id, ds.name, ds.spec, ds.palette, ds.is_default, ds.created_at, ds.updated_at);
  return ds;
}

/** Own systems plus ones shared with the user (marked shared + owner name). */
export function listDesignSystems(userId: string): DesignSystem[] {
  const own = db
    .prepare(
      "SELECT * FROM design_systems WHERE user_id = ? ORDER BY is_default DESC, updated_at DESC"
    )
    .all(userId) as DesignSystem[];
  const shared = db
    .prepare(
      `SELECT d.*, u.name AS owner_name FROM design_system_shares s
       JOIN design_systems d ON d.id = s.design_system_id
       JOIN users u ON u.id = d.user_id
       WHERE s.user_id = ? ORDER BY d.updated_at DESC`
    )
    .all(userId) as DesignSystem[];
  return [...own, ...shared.map((s) => ({ ...s, shared: true, is_default: 0 }))];
}

export function getDesignSystem(id: string): DesignSystem | undefined {
  return db.prepare("SELECT * FROM design_systems WHERE id = ?").get(id) as
    | DesignSystem
    | undefined;
}

/** Owner or share recipient can read/apply the system. */
export function canAccessDesignSystem(id: string, userId: string): boolean {
  const ds = getDesignSystem(id);
  if (!ds) return false;
  if (ds.user_id === userId) return true;
  return Boolean(
    db
      .prepare(
        "SELECT 1 FROM design_system_shares WHERE design_system_id = ? AND user_id = ?"
      )
      .get(id, userId)
  );
}

export function updateDesignSystem(
  id: string,
  fields: Partial<Pick<DesignSystem, "name" | "spec" | "palette">>
) {
  const ds = getDesignSystem(id);
  if (!ds) return;
  const merged = { ...ds, ...fields, updated_at: now() };
  db.prepare(
    "UPDATE design_systems SET name = @name, spec = @spec, palette = @palette, updated_at = @updated_at WHERE id = @id"
  ).run(merged);
}

/** Make `id` the user's default (or clear the default entirely with null). */
export function setDefaultDesignSystem(userId: string, id: string | null) {
  db.prepare("UPDATE design_systems SET is_default = 0 WHERE user_id = ?").run(userId);
  if (id) {
    db.prepare(
      "UPDATE design_systems SET is_default = 1 WHERE id = ? AND user_id = ?"
    ).run(id, userId);
  }
}

export function deleteDesignSystem(id: string) {
  db.prepare("DELETE FROM design_system_shares WHERE design_system_id = ?").run(id);
  db.prepare("DELETE FROM design_systems WHERE id = ?").run(id);
}

export function shareDesignSystem(id: string, recipientId: string) {
  db.prepare(
    "INSERT OR IGNORE INTO design_system_shares (design_system_id, user_id, added_at) VALUES (?, ?, ?)"
  ).run(id, recipientId, now());
}

export function unshareDesignSystem(id: string, recipientId: string) {
  db.prepare(
    "DELETE FROM design_system_shares WHERE design_system_id = ? AND user_id = ?"
  ).run(id, recipientId);
}

export function listDesignSystemShares(
  id: string
): { user_id: string; email: string; name: string }[] {
  return db
    .prepare(
      `SELECT s.user_id, u.email, u.name FROM design_system_shares s
       JOIN users u ON u.id = s.user_id WHERE s.design_system_id = ? ORDER BY s.added_at ASC`
    )
    .all(id) as { user_id: string; email: string; name: string }[];
}

// ---------------------------------------------------------------------------
// Artifact shares — user-to-user. Recipients see the artifact in "Shared with
// you" and can open it as an editable copy in their own Design workspace.

export function shareArtifactWithUser(artifactId: string, recipientId: string) {
  db.prepare(
    "INSERT OR IGNORE INTO artifact_shares (artifact_id, user_id, added_at) VALUES (?, ?, ?)"
  ).run(artifactId, recipientId, now());
}

export function unshareArtifactWithUser(artifactId: string, recipientId: string) {
  db.prepare("DELETE FROM artifact_shares WHERE artifact_id = ? AND user_id = ?").run(
    artifactId,
    recipientId
  );
}

export function listArtifactShares(
  artifactId: string
): { user_id: string; email: string; name: string }[] {
  return db
    .prepare(
      `SELECT s.user_id, u.email, u.name FROM artifact_shares s
       JOIN users u ON u.id = s.user_id WHERE s.artifact_id = ? ORDER BY s.added_at ASC`
    )
    .all(artifactId) as { user_id: string; email: string; name: string }[];
}

/** True when the artifact was shared to this user (not ownership). */
export function isArtifactSharedWith(artifactId: string, userId: string): boolean {
  return Boolean(
    db
      .prepare("SELECT 1 FROM artifact_shares WHERE artifact_id = ? AND user_id = ?")
      .get(artifactId, userId)
  );
}

/** Artifacts shared with the user, newest first, with the owner's name. */
export function listArtifactsSharedWith(userId: string): {
  artifact_id: string;
  identifier: string;
  type: string;
  title: string;
  language: string | null;
  owner_name: string;
  shared_at: number;
  updated_at: number;
}[] {
  return db
    .prepare(
      `SELECT a.id AS artifact_id, a.identifier, a.type, a.title, a.language,
              u.name AS owner_name, s.added_at AS shared_at, a.updated_at
       FROM artifact_shares s
       JOIN artifacts a ON a.id = s.artifact_id
       JOIN conversations c ON c.id = a.conversation_id
       JOIN users u ON u.id = c.user_id
       WHERE s.user_id = ? ORDER BY s.added_at DESC`
    )
    .all(userId) as {
    artifact_id: string;
    identifier: string;
    type: string;
    title: string;
    language: string | null;
    owner_name: string;
    shared_at: number;
    updated_at: number;
  }[];
}

export function getProject(id: string): Project | undefined {
  return db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as
    | Project
    | undefined;
}

export function createProject(
  name: string,
  instructions = "",
  userId: string = DEFAULT_USER
): Project {
  const project = { id: newId(), name, instructions, user_id: userId, created_at: now() };
  db.prepare(
    "INSERT INTO projects (id, name, instructions, user_id, created_at) VALUES (@id, @name, @instructions, @user_id, @created_at)"
  ).run(project);
  return project as Project;
}

export function updateProject(
  id: string,
  fields: Partial<Pick<Project, "name" | "instructions">>
) {
  const project = getProject(id);
  if (!project) return;
  const merged = { ...project, ...fields };
  db.prepare("UPDATE projects SET name = @name, instructions = @instructions WHERE id = @id").run(
    merged
  );
}

export function deleteProject(id: string) {
  db.prepare("DELETE FROM project_members WHERE project_id = ?").run(id);
  db.prepare("DELETE FROM project_files WHERE project_id = ?").run(id);
  db.prepare("UPDATE conversations SET project_id = NULL WHERE project_id = ?").run(id);
  db.prepare("DELETE FROM projects WHERE id = ?").run(id);
}

export function listProjectFiles(projectId: string): ProjectFile[] {
  return db
    .prepare("SELECT * FROM project_files WHERE project_id = ? ORDER BY created_at ASC")
    .all(projectId) as ProjectFile[];
}

export function addProjectFile(projectId: string, name: string, content: string): ProjectFile {
  const file: ProjectFile = {
    id: newId(),
    project_id: projectId,
    name,
    content,
    created_at: now(),
  };
  db.prepare(
    "INSERT INTO project_files (id, project_id, name, content, created_at) VALUES (@id, @project_id, @name, @content, @created_at)"
  ).run(file);
  return file;
}

export function deleteProjectFile(id: string, projectId?: string) {
  // When projectId is given, scope the delete to it so a caller can't remove a
  // file that belongs to a different (foreign) project.
  if (projectId) {
    db.prepare("DELETE FROM project_files WHERE id = ? AND project_id = ?").run(id, projectId);
  } else {
    db.prepare("DELETE FROM project_files WHERE id = ?").run(id);
  }
}

// ---------- artifacts ----------

import type { ArtifactRecord, ArtifactVersion, ArtifactType } from "./artifact-shared";

export function getArtifactByIdentifier(
  conversationId: string,
  identifier: string
): ArtifactRecord | undefined {
  return db
    .prepare("SELECT * FROM artifacts WHERE conversation_id = ? AND identifier = ?")
    .get(conversationId, identifier) as ArtifactRecord | undefined;
}

export function getArtifact(id: string): ArtifactRecord | undefined {
  return db.prepare("SELECT * FROM artifacts WHERE id = ?").get(id) as
    | ArtifactRecord
    | undefined;
}

export function listArtifacts(conversationId: string): ArtifactRecord[] {
  return db
    .prepare("SELECT * FROM artifacts WHERE conversation_id = ? ORDER BY created_at ASC")
    .all(conversationId) as ArtifactRecord[];
}

export function listArtifactVersions(artifactId: string): ArtifactVersion[] {
  return db
    .prepare("SELECT * FROM artifact_versions WHERE artifact_id = ? ORDER BY version ASC")
    .all(artifactId) as ArtifactVersion[];
}

export function getArtifactVersion(
  artifactId: string,
  version?: number | null
): ArtifactVersion | undefined {
  if (version != null) {
    return db
      .prepare("SELECT * FROM artifact_versions WHERE artifact_id = ? AND version = ?")
      .get(artifactId, version) as ArtifactVersion | undefined;
  }
  return db
    .prepare(
      "SELECT * FROM artifact_versions WHERE artifact_id = ? ORDER BY version DESC LIMIT 1"
    )
    .get(artifactId) as ArtifactVersion | undefined;
}

export function upsertArtifact(
  conversationId: string,
  identifier: string,
  fields: { type: ArtifactType; language: string | null; title: string }
): ArtifactRecord {
  const existing = getArtifactByIdentifier(conversationId, identifier);
  if (existing) {
    db.prepare(
      "UPDATE artifacts SET type = ?, language = ?, title = ?, updated_at = ? WHERE id = ?"
    ).run(fields.type, fields.language, fields.title, now(), existing.id);
    return getArtifact(existing.id)!;
  }
  const record: ArtifactRecord = {
    id: newId(),
    conversation_id: conversationId,
    identifier,
    type: fields.type,
    language: fields.language,
    title: fields.title,
    share_id: null,
    share_mode: null,
    pinned_version: null,
    created_at: now(),
    updated_at: now(),
  };
  db.prepare(
    `INSERT INTO artifacts (id, conversation_id, identifier, type, language, title, share_id, share_mode, pinned_version, created_at, updated_at)
     VALUES (@id, @conversation_id, @identifier, @type, @language, @title, @share_id, @share_mode, @pinned_version, @created_at, @updated_at)`
  ).run(record);
  return record;
}

export function addArtifactVersion(
  artifactId: string,
  content: string,
  messageId: string | null
): ArtifactVersion {
  const latest = getArtifactVersion(artifactId);
  const version: ArtifactVersion = {
    id: newId(),
    artifact_id: artifactId,
    version: (latest?.version ?? 0) + 1,
    content,
    message_id: messageId,
    created_at: now(),
  };
  db.prepare(
    "INSERT INTO artifact_versions (id, artifact_id, version, content, message_id, created_at) VALUES (@id, @artifact_id, @version, @content, @message_id, @created_at)"
  ).run(version);
  db.prepare("UPDATE artifacts SET updated_at = ? WHERE id = ?").run(now(), artifactId);
  return version;
}

export function setArtifactShare(
  id: string,
  share: { share_id: string | null; share_mode: "latest" | "pinned" | null; pinned_version: number | null }
) {
  db.prepare(
    "UPDATE artifacts SET share_id = ?, share_mode = ?, pinned_version = ?, updated_at = ? WHERE id = ?"
  ).run(share.share_id, share.share_mode, share.pinned_version, now(), id);
}

export function getArtifactByShareId(
  shareId: string
): (ArtifactRecord & { resolved: ArtifactVersion | undefined }) | undefined {
  const record = db
    .prepare("SELECT * FROM artifacts WHERE share_id = ?")
    .get(shareId) as ArtifactRecord | undefined;
  if (!record) return undefined;
  const resolved =
    record.share_mode === "pinned"
      ? getArtifactVersion(record.id, record.pinned_version)
      : getArtifactVersion(record.id);
  return { ...record, resolved };
}

export function deleteArtifactsForConversation(conversationId: string) {
  const ids = db
    .prepare("SELECT id FROM artifacts WHERE conversation_id = ?")
    .all(conversationId) as { id: string }[];
  for (const { id } of ids) {
    db.prepare("DELETE FROM artifact_versions WHERE artifact_id = ?").run(id);
    db.prepare("DELETE FROM artifacts WHERE id = ?").run(id);
  }
}

/** Remove versions created by deleted messages; drop artifacts left with no versions. */
export function pruneArtifactVersionsForMessages(messageIds: string[]) {
  if (messageIds.length === 0) return;
  const placeholders = messageIds.map(() => "?").join(",");
  db.prepare(
    `DELETE FROM artifact_versions WHERE message_id IN (${placeholders})`
  ).run(...messageIds);
  db.prepare(
    "DELETE FROM artifacts WHERE id NOT IN (SELECT DISTINCT artifact_id FROM artifact_versions)"
  ).run();
}

// ---------- memories ----------

export interface MemoryRecord {
  id: string;
  content: string;
  created_at: number;
}

export function listMemories(userId: string = DEFAULT_USER): MemoryRecord[] {
  return db
    .prepare("SELECT * FROM memories WHERE user_id = ? ORDER BY created_at DESC")
    .all(userId) as MemoryRecord[];
}

export function addMemory(content: string, userId: string = DEFAULT_USER): MemoryRecord {
  const trimmed = content.trim();
  const existing = db
    .prepare("SELECT * FROM memories WHERE user_id = ? AND content = ?")
    .get(userId, trimmed) as MemoryRecord | undefined;
  if (existing) return existing;
  const record = { id: newId(), content: trimmed, user_id: userId, created_at: now() };
  db.prepare(
    "INSERT INTO memories (id, content, user_id, created_at) VALUES (@id, @content, @user_id, @created_at)"
  ).run(record);
  return record as MemoryRecord;
}

export function updateMemory(id: string, content: string) {
  db.prepare("UPDATE memories SET content = ? WHERE id = ?").run(content.trim(), id);
}

export function deleteMemory(id: string) {
  db.prepare("DELETE FROM memories WHERE id = ?").run(id);
}

/** Resolve a memory by id prefix (the model sees 8-char handles). */
export function findMemoryByPrefix(
  prefix: string,
  userId: string = DEFAULT_USER
): MemoryRecord | undefined {
  if (!prefix) return undefined;
  return listMemories(userId).find((m) => m.id.startsWith(prefix));
}

// ---------- shared chats ----------

export interface SharedChat {
  id: string;
  conversation_id: string;
  title: string;
  snapshot: string;
  created_at: number;
}

/** Copy a conversation and its messages into a new one owned by the user. */
export function forkConversation(
  sourceId: string,
  userId: string = DEFAULT_USER
): Conversation | null {
  const src = getConversation(sourceId);
  if (!src) return null;
  const conv = createConversation(src.model, src.project_id ?? null, false, userId);
  updateConversation(conv.id, { title: `${src.title} (copy)` });
  for (const m of listMessages(sourceId)) {
    addMessage(conv.id, m.role, m.content, m.model, m.attachments, {
      reasoning: m.reasoning ?? null,
      annotations: m.annotations ?? null,
      images: m.images ?? null,
      tool_calls: m.tool_calls ?? null,
      tool_call_id: m.tool_call_id ?? null,
      cost: m.cost ?? null,
      tokens_in: m.tokens_in ?? null,
      tokens_out: m.tokens_out ?? null,
    });
  }
  return getConversation(conv.id) ?? conv;
}

export function createSharedChat(conversationId: string): SharedChat | null {
  const conv = getConversation(conversationId);
  if (!conv) return null;
  const snapshot = JSON.stringify(
    listMessages(conversationId).map((m) => ({
      role: m.role,
      content: m.content,
      model: m.model,
      images: m.images,
      created_at: m.created_at,
    }))
  );
  const record = {
    id: crypto.randomBytes(8).toString("base64url"),
    conversation_id: conversationId,
    title: conv.title,
    snapshot,
    user_id: conv.user_id ?? DEFAULT_USER,
    created_at: now(),
  };
  db.prepare(
    "INSERT INTO shared_chats (id, conversation_id, title, snapshot, user_id, created_at) VALUES (@id, @conversation_id, @title, @snapshot, @user_id, @created_at)"
  ).run(record);
  return record as SharedChat;
}

export function getSharedChat(id: string): SharedChat | undefined {
  return db.prepare("SELECT * FROM shared_chats WHERE id = ?").get(id) as
    | SharedChat
    | undefined;
}

export function deleteSharedChatsFor(conversationId: string) {
  db.prepare("DELETE FROM shared_chats WHERE conversation_id = ?").run(conversationId);
}

// ---------- model providers (Azure / Bedrock / Google / custom OpenAI-compatible) ----------

export interface ProviderRecord {
  id: string;
  user_id: string;
  kind: "openai" | "anthropic" | "azure" | "bedrock" | "google" | "custom";
  name: string;
  config: string; // JSON: endpoint/region/apiKey/apiVersion/models[]
  enabled: number;
  created_at: number;
}

export function listProviders(userId: string = DEFAULT_USER): ProviderRecord[] {
  const rows = db
    .prepare("SELECT * FROM providers WHERE user_id = ? ORDER BY created_at ASC")
    .all(userId) as ProviderRecord[];
  return rows.map((r) => ({ ...r, config: decProviderConfig(r.config) as string }));
}

export function getProvider(id: string): ProviderRecord | undefined {
  const r = db.prepare("SELECT * FROM providers WHERE id = ?").get(id) as
    | ProviderRecord
    | undefined;
  return r ? { ...r, config: decProviderConfig(r.config) as string } : undefined;
}

export function createProvider(
  input: { kind: ProviderRecord["kind"]; name: string; config: Record<string, unknown> },
  userId: string = DEFAULT_USER
): ProviderRecord {
  const record: ProviderRecord = {
    id: newId(),
    user_id: userId,
    kind: input.kind,
    name: input.name,
    config: JSON.stringify(input.config),
    enabled: 1,
    created_at: now(),
  };
  db.prepare(
    "INSERT INTO providers (id, user_id, kind, name, config, enabled, created_at) VALUES (@id, @user_id, @kind, @name, @config, @enabled, @created_at)"
  ).run({ ...record, config: encProviderConfig(record.config) });
  return record;
}

export function updateProvider(id: string, fields: Partial<Pick<ProviderRecord, "enabled" | "name" | "config">>) {
  const record = getProvider(id);
  if (!record) return;
  const merged = { ...record, ...fields };
  db.prepare("UPDATE providers SET name=@name, config=@config, enabled=@enabled WHERE id=@id").run({
    ...merged,
    config: encProviderConfig(merged.config),
  });
}

export function deleteProvider(id: string) {
  db.prepare("DELETE FROM providers WHERE id = ?").run(id);
}

// ---------- connectors (MCP servers) ----------

export interface Connector {
  id: string;
  name: string;
  transport: "stdio" | "http";
  command: string | null;
  args: string | null; // JSON array
  url: string | null;
  headers: string | null; // JSON object
  oauth_data: string | null; // JSON: tokens, client info, verifier, redirect
  tools_cache: string | null; // JSON: [{name, description}] discovered on last test
  last_tested: number | null;
  enabled: number;
  user_id: string;
  created_at: number;
}

/** Persist the tool list discovered by a successful connector test, so the UI
 *  can show a server's functions instantly without reconnecting each time. */
export function setConnectorTools(
  id: string,
  tools: { name: string; description: string }[]
) {
  db.prepare("UPDATE connectors SET tools_cache = ?, last_tested = ? WHERE id = ?").run(
    JSON.stringify(tools),
    now(),
    id
  );
}

export function getConnectorOAuth(id: string): Record<string, unknown> {
  const row = getConnector(id);
  try {
    return row?.oauth_data ? JSON.parse(row.oauth_data) : {};
  } catch {
    return {};
  }
}

export function saveConnectorOAuth(id: string, patch: Record<string, unknown>) {
  const merged = { ...getConnectorOAuth(id), ...patch };
  db.prepare("UPDATE connectors SET oauth_data = ? WHERE id = ?").run(
    encryptSecret(JSON.stringify(merged)),
    id
  );
}

/** Decrypt a connector's secret-bearing columns (headers, oauth_data) for use. */
function decConnector(c: Connector): Connector {
  return {
    ...c,
    headers: decryptSecret(c.headers),
    oauth_data: decryptSecret(c.oauth_data),
  };
}

export function listConnectors(userId: string = DEFAULT_USER): Connector[] {
  const rows = db
    .prepare("SELECT * FROM connectors WHERE user_id = ? ORDER BY created_at ASC")
    .all(userId) as Connector[];
  return rows.map(decConnector);
}

export function getConnector(id: string): Connector | undefined {
  const r = db.prepare("SELECT * FROM connectors WHERE id = ?").get(id) as
    | Connector
    | undefined;
  return r ? decConnector(r) : undefined;
}

export function createConnector(
  input: {
    name: string;
    transport: "stdio" | "http";
    command?: string | null;
    args?: string | null;
    url?: string | null;
    headers?: string | null;
  },
  userId: string = DEFAULT_USER
): Connector {
  const record = {
    id: newId(),
    name: input.name,
    transport: input.transport,
    command: input.command ?? null,
    args: input.args ?? null,
    url: input.url ?? null,
    headers: input.headers ?? null,
    oauth_data: null,
    tools_cache: null,
    last_tested: null,
    enabled: 1,
    user_id: userId,
    created_at: now(),
  };
  db.prepare(
    "INSERT INTO connectors (id, name, transport, command, args, url, headers, oauth_data, tools_cache, last_tested, enabled, user_id, created_at) VALUES (@id, @name, @transport, @command, @args, @url, @headers, @oauth_data, @tools_cache, @last_tested, @enabled, @user_id, @created_at)"
  ).run({ ...record, headers: encryptSecret(record.headers) });
  return record as Connector;
}

export function updateConnector(id: string, fields: Partial<Connector>) {
  const record = getConnector(id);
  if (!record) return;
  const merged = { ...record, ...fields };
  db.prepare(
    "UPDATE connectors SET name=@name, transport=@transport, command=@command, args=@args, url=@url, headers=@headers, enabled=@enabled WHERE id=@id"
  ).run({ ...merged, headers: encryptSecret(merged.headers) });
}

export function deleteConnector(id: string) {
  db.prepare("DELETE FROM connectors WHERE id = ?").run(id);
}

// ---------- http tools (user-defined REST endpoints) ----------

function rowToHttpTool(r: Record<string, unknown>): HttpTool & { auth_secret: string | null } {
  const safeJson = <T,>(s: unknown, fallback: T): T => {
    try {
      return s ? (JSON.parse(s as string) as T) : fallback;
    } catch {
      return fallback;
    }
  };
  return {
    id: r.id as string,
    user_id: r.user_id as string,
    name: r.name as string,
    description: (r.description as string) ?? "",
    method: (r.method as string) ?? "GET",
    url_template: r.url_template as string,
    params: safeJson<HttpToolParam[]>(r.params, []),
    headers: safeJson<Record<string, string>>(r.headers, {}),
    auth: safeJson<HttpToolAuth>(r.auth, { type: "none" }),
    auth_secret: decryptSecret((r.auth_secret as string) ?? null),
    body_mode: ((r.body_mode as string) ?? "auto") as "auto" | "template",
    body_template: (r.body_template as string) ?? null,
    response_extract: (r.response_extract as string) ?? null,
    max_response_bytes: Number(r.max_response_bytes ?? 24576),
    auto_run: Number(r.auto_run ?? 0),
    source: ((r.source as string) ?? "manual") as "manual" | "openapi",
    openapi_group: (r.openapi_group as string) ?? null,
    enabled: Number(r.enabled ?? 1),
    created_at: Number(r.created_at ?? 0),
  };
}

export function redactHttpTool(t: HttpTool & { auth_secret?: string | null }): HttpTool {
  const { auth_secret, ...rest } = t;
  return { ...rest, auth: { ...rest.auth, hasSecret: Boolean(auth_secret) } };
}

export function listHttpTools(userId: string, withSecret = false): HttpTool[] {
  const rows = db
    .prepare("SELECT * FROM http_tools WHERE user_id = ? ORDER BY created_at DESC")
    .all(userId) as Record<string, unknown>[];
  return rows.map((r) => {
    const t = rowToHttpTool(r);
    return withSecret ? t : redactHttpTool(t);
  });
}

export function getHttpTool(
  id: string,
  userId: string
): (HttpTool & { auth_secret: string | null }) | undefined {
  const row = db
    .prepare("SELECT * FROM http_tools WHERE id = ? AND user_id = ?")
    .get(id, userId) as Record<string, unknown> | undefined;
  return row ? rowToHttpTool(row) : undefined;
}

export function getHttpToolByName(
  userId: string,
  name: string
): (HttpTool & { auth_secret: string | null }) | undefined {
  const row = db
    .prepare("SELECT * FROM http_tools WHERE user_id = ? AND name = ? AND enabled = 1")
    .get(userId, name) as Record<string, unknown> | undefined;
  return row ? rowToHttpTool(row) : undefined;
}

export function createHttpTool(
  userId: string,
  t: Omit<HttpTool, "id" | "user_id" | "created_at"> & { auth_secret?: string | null }
): HttpTool {
  const id = newId();
  const createdAt = Date.now();
  db.prepare(
    `INSERT INTO http_tools
      (id, user_id, name, description, method, url_template, params, headers, auth, auth_secret,
       body_mode, body_template, response_extract, max_response_bytes, auto_run, source, openapi_group, enabled, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    id,
    userId,
    t.name,
    t.description,
    t.method,
    t.url_template,
    JSON.stringify(t.params ?? []),
    JSON.stringify(t.headers ?? {}),
    JSON.stringify(t.auth ?? { type: "none" }),
    encryptSecret(t.auth_secret ?? null),
    t.body_mode ?? "auto",
    t.body_template ?? null,
    t.response_extract ?? null,
    t.max_response_bytes ?? 24576,
    t.auto_run ?? 0,
    t.source ?? "manual",
    t.openapi_group ?? null,
    t.enabled ?? 1,
    createdAt
  );
  return { ...(t as HttpTool), id, user_id: userId, created_at: createdAt };
}

export function updateHttpTool(
  id: string,
  userId: string,
  fields: Partial<HttpTool & { auth_secret: string | null }>
) {
  const cur = getHttpTool(id, userId);
  if (!cur) return;
  const m = { ...cur, ...fields };
  db.prepare(
    `UPDATE http_tools SET name=?, description=?, method=?, url_template=?, params=?, headers=?,
       auth=?, auth_secret=?, body_mode=?, body_template=?, response_extract=?,
       max_response_bytes=?, auto_run=?, enabled=? WHERE id=? AND user_id=?`
  ).run(
    m.name,
    m.description,
    m.method,
    m.url_template,
    JSON.stringify(m.params ?? []),
    JSON.stringify(m.headers ?? {}),
    JSON.stringify(m.auth ?? { type: "none" }),
    encryptSecret(fields.auth_secret === undefined ? cur.auth_secret : fields.auth_secret),
    m.body_mode,
    m.body_template ?? null,
    m.response_extract ?? null,
    m.max_response_bytes,
    m.auto_run,
    m.enabled,
    id,
    userId
  );
}

export function deleteHttpTool(id: string, userId: string) {
  db.prepare("DELETE FROM http_tools WHERE id = ? AND user_id = ?").run(id, userId);
}

export function deleteHttpToolGroup(openapiGroup: string, userId: string) {
  db.prepare("DELETE FROM http_tools WHERE openapi_group = ? AND user_id = ?").run(openapiGroup, userId);
}

// ---------- skills ----------

export interface SkillRecord {
  id: string;
  name: string;
  description: string;
  instructions: string;
  connector_ids: string | null; // JSON array of connector ids this skill bundles
  http_tool_ids: string | null; // JSON array of http-tool ids this skill bundles
  enabled: number;
  user_id: string;
  created_at: number;
}

export function listSkills(userId: string = DEFAULT_USER): SkillRecord[] {
  return db
    .prepare("SELECT * FROM skills WHERE user_id = ? ORDER BY created_at ASC")
    .all(userId) as SkillRecord[];
}

export function getSkill(id: string): SkillRecord | undefined {
  return db.prepare("SELECT * FROM skills WHERE id = ?").get(id) as
    | SkillRecord
    | undefined;
}

export function createSkill(
  input: {
    name: string;
    description: string;
    instructions: string;
    connectorIds?: string[];
    httpToolIds?: string[];
  },
  userId: string = DEFAULT_USER
): SkillRecord {
  const record = {
    id: newId(),
    name: input.name,
    description: input.description,
    instructions: input.instructions,
    connector_ids: input.connectorIds?.length ? JSON.stringify(input.connectorIds) : null,
    http_tool_ids: input.httpToolIds?.length ? JSON.stringify(input.httpToolIds) : null,
    enabled: 1,
    user_id: userId,
    created_at: now(),
  };
  db.prepare(
    "INSERT INTO skills (id, name, description, instructions, connector_ids, http_tool_ids, enabled, user_id, created_at) VALUES (@id, @name, @description, @instructions, @connector_ids, @http_tool_ids, @enabled, @user_id, @created_at)"
  ).run(record);
  return record as SkillRecord;
}

export function updateSkill(id: string, fields: Partial<SkillRecord>) {
  const record = getSkill(id);
  if (!record) return;
  const merged = { ...record, ...fields };
  db.prepare(
    "UPDATE skills SET name=@name, description=@description, instructions=@instructions, connector_ids=@connector_ids, http_tool_ids=@http_tool_ids, enabled=@enabled WHERE id=@id"
  ).run(merged);
}

export function deleteSkill(id: string) {
  db.prepare("DELETE FROM skills WHERE id = ?").run(id);
}

// ---------- push subscriptions ----------

export interface PushSubscriptionRecord {
  endpoint: string;
  user_id: string;
  subscription: string; // JSON: the browser PushSubscription
  created_at: number;
}

export function savePushSubscription(
  subscription: { endpoint: string },
  userId: string = DEFAULT_USER
) {
  db.prepare(
    "INSERT INTO push_subscriptions (endpoint, user_id, subscription, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET subscription = excluded.subscription, user_id = excluded.user_id"
  ).run(subscription.endpoint, userId, JSON.stringify(subscription), now());
}

export function listPushSubscriptions(
  userId: string = DEFAULT_USER
): PushSubscriptionRecord[] {
  return db
    .prepare("SELECT * FROM push_subscriptions WHERE user_id = ?")
    .all(userId) as PushSubscriptionRecord[];
}

export function deletePushSubscription(endpoint: string, userId?: string) {
  if (userId) {
    db.prepare(
      "DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?"
    ).run(endpoint, userId);
  } else {
    db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(endpoint);
  }
}

// ---------- scheduled tasks ----------

export interface ScheduledTask {
  id: string;
  name: string;
  prompt: string;
  schedule_kind: "interval" | "daily";
  interval_minutes: number | null;
  daily_time: string | null; // "HH:MM" local time
  web_search: number;
  model: string | null;
  enabled: number;
  next_run: number;
  last_run: number | null;
  last_conversation_id: string | null;
  last_error: string | null;
  user_id?: string;
  created_at: number;
}

export function computeNextRun(
  kind: "interval" | "daily",
  intervalMinutes: number | null,
  dailyTime: string | null,
  from = Date.now()
): number {
  if (kind === "interval") {
    const minutes = Math.max(5, intervalMinutes ?? 60);
    return from + minutes * 60_000;
  }
  const [h, m] = (dailyTime ?? "09:00").split(":").map(Number);
  const next = new Date(from);
  next.setHours(h || 0, m || 0, 0, 0);
  if (next.getTime() <= from) next.setDate(next.getDate() + 1);
  return next.getTime();
}

export function listScheduledTasks(userId: string = DEFAULT_USER): ScheduledTask[] {
  return db
    .prepare("SELECT * FROM scheduled_tasks WHERE user_id = ? ORDER BY created_at DESC")
    .all(userId) as ScheduledTask[];
}

export function getScheduledTask(id: string): ScheduledTask | undefined {
  return db.prepare("SELECT * FROM scheduled_tasks WHERE id = ?").get(id) as
    | ScheduledTask
    | undefined;
}

export function listDueTasks(asOf = Date.now()): ScheduledTask[] {
  return db
    .prepare("SELECT * FROM scheduled_tasks WHERE enabled = 1 AND next_run <= ?")
    .all(asOf) as ScheduledTask[];
}

export function createScheduledTask(
  input: {
    name: string;
    prompt: string;
    schedule_kind: "interval" | "daily";
    interval_minutes?: number | null;
    daily_time?: string | null;
    web_search?: boolean;
    model?: string | null;
  },
  userId: string = DEFAULT_USER
): ScheduledTask {
  const task: ScheduledTask = {
    user_id: userId,
    id: newId(),
    name: input.name,
    prompt: input.prompt,
    schedule_kind: input.schedule_kind,
    interval_minutes: input.interval_minutes ?? null,
    daily_time: input.daily_time ?? null,
    web_search: input.web_search ? 1 : 0,
    model: input.model ?? null,
    enabled: 1,
    next_run: computeNextRun(
      input.schedule_kind,
      input.interval_minutes ?? null,
      input.daily_time ?? null
    ),
    last_run: null,
    last_conversation_id: null,
    last_error: null,
    created_at: now(),
  };
  db.prepare(
    `INSERT INTO scheduled_tasks (id, name, prompt, schedule_kind, interval_minutes, daily_time, web_search, model, enabled, next_run, last_run, last_conversation_id, last_error, user_id, created_at)
     VALUES (@id, @name, @prompt, @schedule_kind, @interval_minutes, @daily_time, @web_search, @model, @enabled, @next_run, @last_run, @last_conversation_id, @last_error, @user_id, @created_at)`
  ).run(task);
  return task;
}

export function updateScheduledTask(id: string, fields: Partial<ScheduledTask>) {
  const task = getScheduledTask(id);
  if (!task) return;
  const merged = { ...task, ...fields };
  db.prepare(
    `UPDATE scheduled_tasks SET name=@name, prompt=@prompt, schedule_kind=@schedule_kind, interval_minutes=@interval_minutes, daily_time=@daily_time, web_search=@web_search, model=@model, enabled=@enabled, next_run=@next_run, last_run=@last_run, last_conversation_id=@last_conversation_id, last_error=@last_error WHERE id=@id`
  ).run(merged);
}

export function deleteScheduledTask(id: string) {
  db.prepare("DELETE FROM scheduled_tasks WHERE id = ?").run(id);
}

// ---------- platform API keys ----------

export interface ApiKeyRecord {
  id: string;
  name: string;
  key_prefix: string;
  created_at: number;
  last_used_at: number | null;
}

const hashKey = (key: string) =>
  crypto.createHash("sha256").update(key).digest("hex");

export function createPlatformApiKey(
  name: string,
  userId: string = DEFAULT_USER
): { record: ApiKeyRecord; key: string } {
  const key = "lbd-" + crypto.randomBytes(24).toString("base64url");
  const record: ApiKeyRecord = {
    id: newId(),
    name,
    key_prefix: key.slice(0, 10),
    created_at: now(),
    last_used_at: null,
  };
  db.prepare(
    "INSERT INTO api_keys (id, name, key_hash, key_prefix, user_id, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?, NULL)"
  ).run(record.id, record.name, hashKey(key), record.key_prefix, userId, record.created_at);
  return { record, key };
}

export function listPlatformApiKeys(userId: string = DEFAULT_USER): ApiKeyRecord[] {
  return db
    .prepare(
      "SELECT id, name, key_prefix, created_at, last_used_at FROM api_keys WHERE user_id = ? ORDER BY created_at DESC"
    )
    .all(userId) as ApiKeyRecord[];
}

export function deletePlatformApiKey(id: string, userId?: string) {
  if (userId) {
    db.prepare("DELETE FROM api_keys WHERE id = ? AND user_id = ?").run(id, userId);
  } else {
    db.prepare("DELETE FROM api_keys WHERE id = ?").run(id);
  }
}

/** Returns the owning user's id when valid, null otherwise. */
export function verifyPlatformApiKey(key: string): string | null {
  const row = db
    .prepare("SELECT id, user_id FROM api_keys WHERE key_hash = ?")
    .get(hashKey(key)) as { id: string; user_id: string } | undefined;
  if (!row) return null;
  db.prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?").run(now(), row.id);
  return row.user_id || DEFAULT_USER;
}
