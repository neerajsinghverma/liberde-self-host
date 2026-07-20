/* Cost tracking roundtrip through storage and branch snapshots. */
import assert from "node:assert";
import {
  addMessage,
  createConversation,
  deleteConversation,
  listBranches,
  listMessages,
  snapshotTailAsBranch,
  deleteMessagesFrom,
  switchToBranch,
} from "../lib/db";

let passed = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
};

const conv = createConversation("test/model");
try {
  ok("cost and tokens roundtrip through addMessage", () => {
    addMessage(conv.id, "user", "hi");
    const m = addMessage(conv.id, "assistant", "hello", "test/model", null, {
      cost: 0.00342,
      tokens_in: 1200,
      tokens_out: 350,
    });
    assert.equal(m.cost, 0.00342);
    const loaded = listMessages(conv.id).find((x) => x.id === m.id)!;
    assert.equal(loaded.cost, 0.00342);
    assert.equal(loaded.tokens_in, 1200);
    assert.equal(loaded.tokens_out, 350);
  });

  ok("conversation total sums message costs", () => {
    addMessage(conv.id, "user", "more");
    addMessage(conv.id, "assistant", "sure", "test/model", null, { cost: 0.001 });
    const total = listMessages(conv.id).reduce((s, m) => s + (m.cost ?? 0), 0);
    assert.ok(Math.abs(total - 0.00442) < 1e-9, String(total));
  });

  ok("cost survives branch snapshot and restore", () => {
    const target = listMessages(conv.id)[2]; // "more"
    snapshotTailAsBranch(conv.id, target.id);
    deleteMessagesFrom(conv.id, target.id, { pruneArtifacts: false });
    const branch = listBranches(conv.id)[0];
    switchToBranch(conv.id, branch.id);
    const restored = listMessages(conv.id).find((m) => m.content === "sure")!;
    assert.equal(restored.cost, 0.001);
  });
} finally {
  deleteConversation(conv.id);
}

console.log(`\n${passed} tests passed.`);
