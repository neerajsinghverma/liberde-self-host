/* Multi-user tests with full state restoration (test users must never keep
   claimed legacy data or leave the instance in auth-required mode). */
import assert from "node:assert";
import {
  checkLogin,
  countUsers,
  createSession,
  createUser,
  destroySession,
  getUserByToken,
} from "../lib/auth";
import {
  addMemory,
  createConversation,
  db,
  deleteConversation,
  getApiKey,
  getSetting,
  listConversations,
  listMemories,
  setSetting,
  deleteMemory,
} from "../lib/db";

let passed = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
};

assert.equal(countUsers(), 0, "test requires a fresh no-accounts instance");

const cleanup: (() => void)[] = [];
try {
  ok("first user becomes admin and claims legacy data", () => {
    const legacyConv = createConversation("test/model"); // user_id 'local'
    cleanup.push(() => deleteConversation(legacyConv.id));
    const alice = createUser("alice@test.dev", "Alice", "password-alice");
    cleanup.push(() => {
      // Return claimed rows to 'local' and remove the account.
      for (const t of ["settings", "conversations", "projects", "memories", "skills", "connectors", "scheduled_tasks", "api_keys", "shared_chats"]) {
        db.prepare(`UPDATE ${t} SET user_id = 'local' WHERE user_id = ?`).run(alice.id);
      }
      db.prepare("DELETE FROM sessions WHERE user_id = ?").run(alice.id);
      db.prepare("DELETE FROM users WHERE id = ?").run(alice.id);
    });
    assert.equal(alice.is_admin, 1);
    assert.ok(listConversations(alice.id).some((c) => c.id === legacyConv.id));
    assert.ok(!listConversations("local").some((c) => c.id === legacyConv.id));
  });

  ok("second user is isolated", () => {
    const bob = createUser("bob@test.dev", "Bob", "password-bob!!");
    cleanup.push(() => {
      db.prepare("DELETE FROM sessions WHERE user_id = ?").run(bob.id);
      db.prepare("DELETE FROM users WHERE id = ?").run(bob.id);
    });
    assert.equal(bob.is_admin, 0);
    const bobConv = createConversation("test/model", null, false, bob.id);
    cleanup.push(() => deleteConversation(bobConv.id));
    const aliceId = (db.prepare("SELECT id FROM users WHERE email = 'alice@test.dev'").get() as { id: string }).id;
    assert.ok(!listConversations(aliceId).some((c) => c.id === bobConv.id));
    assert.ok(listConversations(bob.id).some((c) => c.id === bobConv.id));
  });

  ok("settings and memory are per-user", () => {
    const aliceId = (db.prepare("SELECT id FROM users WHERE email = 'alice@test.dev'").get() as { id: string }).id;
    const bobId = (db.prepare("SELECT id FROM users WHERE email = 'bob@test.dev'").get() as { id: string }).id;
    setSetting("openrouter_api_key", "sk-alice", aliceId);
    setSetting("openrouter_api_key", "sk-bob", bobId);
    cleanup.push(() => {
      db.prepare("DELETE FROM settings WHERE user_id IN (?, ?)").run(aliceId, bobId);
    });
    assert.equal(getApiKey(aliceId), "sk-alice");
    assert.equal(getApiKey(bobId), "sk-bob");
    assert.equal(getSetting("openrouter_api_key", "nobody"), null);

    const m = addMemory("Bob likes trains", bobId);
    cleanup.push(() => deleteMemory(m.id));
    assert.ok(listMemories(bobId).some((x) => x.id === m.id));
    assert.ok(!listMemories(aliceId).some((x) => x.id === m.id));
  });

  ok("login and sessions roundtrip", () => {
    assert.ok(checkLogin("alice@test.dev", "password-alice"));
    assert.equal(checkLogin("alice@test.dev", "wrong"), null);
    const aliceId = (db.prepare("SELECT id FROM users WHERE email = 'alice@test.dev'").get() as { id: string }).id;
    const token = createSession(aliceId);
    assert.equal(getUserByToken(token)?.id, aliceId);
    destroySession(token);
    assert.equal(getUserByToken(token), undefined);
    assert.equal(getUserByToken("bogus"), undefined);
  });
} finally {
  for (const fn of cleanup.reverse()) fn();
}

assert.equal(countUsers(), 0, "cleanup must remove all test users");
console.log(`\n${passed} tests passed (instance restored to no-accounts mode).`);
