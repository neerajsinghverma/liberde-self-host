/* Unit tests for the feature batch: memory extraction, temp chats, full-text search, share snapshots. */
import assert from "node:assert";
import { buildMemoryContext, extractMemories } from "../lib/memory";
import {
  addMessage,
  createConversation,
  createSharedChat,
  deleteConversation,
  deleteMemory,
  getConversation,
  getSharedChat,
  listConversations,
  listMemories,
  searchConversations,
} from "../lib/db";

let passed = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
};

console.log("Memory:");
const before = listMemories().length;

ok("extractMemories saves facts and strips tags", () => {
  const { cleaned, saved } = extractMemories(
    `Sure!\n<liberdeMemory>The user prefers TypeScript</liberdeMemory>\nHere's the answer.`
  );
  assert.equal(saved, 1);
  assert.ok(!cleaned.includes("liberdeMemory"));
  assert.ok(cleaned.includes("Here's the answer."));
  assert.ok(listMemories().some((m) => m.content === "The user prefers TypeScript"));
});

ok("duplicate memories are not double-saved", () => {
  extractMemories(`<liberdeMemory>The user prefers TypeScript</liberdeMemory>`);
  assert.equal(
    listMemories().filter((m) => m.content === "The user prefers TypeScript").length,
    1
  );
});

ok("buildMemoryContext includes saved facts", () => {
  assert.ok(buildMemoryContext().includes("The user prefers TypeScript"));
});

// cleanup memories created here
for (const m of listMemories().slice(0, listMemories().length - before)) {
  if (m.content === "The user prefers TypeScript") deleteMemory(m.id);
}

console.log("Temp chats & search:");
const temp = createConversation("test/model", null, true);
const normal = createConversation("test/model");
try {
  ok("temp chat exists but is hidden from history", () => {
    assert.ok(getConversation(temp.id));
    assert.ok(!listConversations().some((c) => c.id === temp.id));
    assert.ok(listConversations().some((c) => c.id === normal.id));
  });

  ok("full-text search finds message content", () => {
    addMessage(normal.id, "user", "the zanzibar protocol needs review");
    const hits = searchConversations("zanzibar protocol");
    assert.ok(hits.some((c) => c.id === normal.id));
    assert.equal(searchConversations("xyzzy-nonexistent-term").length, 0);
  });

  ok("share snapshot captures messages and survives edits", () => {
    addMessage(normal.id, "assistant", "Reviewed. All good.");
    const shared = createSharedChat(normal.id)!;
    const fetched = getSharedChat(shared.id)!;
    const snapshot = JSON.parse(fetched.snapshot);
    assert.equal(snapshot.length, 2);
    assert.ok(snapshot[1].content.includes("All good"));
    // snapshot is immutable: later messages don't appear
    addMessage(normal.id, "user", "one more thing");
    assert.equal(JSON.parse(getSharedChat(shared.id)!.snapshot).length, 2);
  });

  ok("deleting the conversation removes its share links", () => {
    const shared = createSharedChat(normal.id)!;
    deleteConversation(normal.id);
    assert.equal(getSharedChat(shared.id), undefined);
  });
} finally {
  deleteConversation(temp.id);
  deleteConversation(normal.id);
}

console.log(`\n${passed} tests passed.`);
