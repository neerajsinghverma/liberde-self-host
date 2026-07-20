/* Branch engine tests: snapshot on truncate, switch swaps tails, star/archive. */
import assert from "node:assert";
import {
  addMessage,
  createConversation,
  deleteConversation,
  deleteMessagesFrom,
  getArtifactByIdentifier,
  listArchivedConversations,
  listBranches,
  listConversations,
  listMessages,
  snapshotTailAsBranch,
  switchToBranch,
  updateConversation,
} from "../lib/db";
import { processAssistantArtifacts } from "../lib/artifacts";

let passed = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
};

const conv = createConversation("test/model");
try {
  console.log("Branching:");
  addMessage(conv.id, "user", "first question");
  addMessage(conv.id, "assistant", "first answer");
  const editTarget = addMessage(conv.id, "user", "original second question");
  addMessage(conv.id, "assistant", "original second answer");

  ok("snapshot captures the tail with correct anchor", () => {
    const branch = snapshotTailAsBranch(conv.id, editTarget.id)!;
    assert.ok(branch);
    assert.equal(branch.preview, "original second question");
    const anchor = listMessages(conv.id)[1]; // "first answer"
    assert.equal(branch.anchor_id, anchor.id);
    // simulate the edit flow: truncate then add the new variant
    deleteMessagesFrom(conv.id, editTarget.id);
    addMessage(conv.id, "user", "edited second question");
    addMessage(conv.id, "assistant", "edited second answer");
    assert.equal(listMessages(conv.id).length, 4);
  });

  ok("switch swaps live tail with the branch", () => {
    const branch = listBranches(conv.id)[0];
    const restored = switchToBranch(conv.id, branch.id)!;
    assert.equal(restored[0].content, "original second question");
    const msgs = listMessages(conv.id);
    assert.equal(msgs.length, 4);
    assert.equal(msgs[2].content, "original second question");
    assert.equal(msgs[3].content, "original second answer");
    // the edited tail is now stored as the alternate branch
    const after = listBranches(conv.id);
    assert.equal(after.length, 1);
    assert.equal(after[0].preview, "edited second question");
  });

  ok("switching back restores the edited variant", () => {
    const branch = listBranches(conv.id)[0];
    switchToBranch(conv.id, branch.id);
    const msgs = listMessages(conv.id);
    assert.equal(msgs[2].content, "edited second question");
    assert.equal(listBranches(conv.id)[0].preview, "original second question");
  });

  ok("artifact versions survive branch snapshot + truncate", () => {
    const artMsg = addMessage(
      conv.id,
      "assistant",
      `<liberdeArtifact identifier="branch-art" command="create" type="html" title="BranchArt">\n<h1>hi</h1>\n</liberdeArtifact>`
    );
    processAssistantArtifacts(conv.id, artMsg.id, artMsg.content);
    assert.ok(getArtifactByIdentifier(conv.id, "branch-art"));
    // Simulate the chat route's edit flow: snapshot first, then truncate without pruning.
    snapshotTailAsBranch(conv.id, artMsg.id);
    deleteMessagesFrom(conv.id, artMsg.id, { pruneArtifacts: false });
    assert.ok(
      getArtifactByIdentifier(conv.id, "branch-art"),
      "artifact must survive when its tail became a branch"
    );
  });

  console.log("Star & archive:");
  ok("star and archive roundtrip", () => {
    updateConversation(conv.id, { starred: 1 });
    assert.equal(listConversations().find((c) => c.id === conv.id)?.starred, 1);
    updateConversation(conv.id, { archived: 1 });
    assert.ok(!listConversations().some((c) => c.id === conv.id));
    assert.ok(listArchivedConversations().some((c) => c.id === conv.id));
    updateConversation(conv.id, { archived: 0 });
    assert.ok(listConversations().some((c) => c.id === conv.id));
  });

  ok("deleting a conversation removes its branches", () => {
    assert.ok(listBranches(conv.id).length >= 1);
    deleteConversation(conv.id);
    assert.equal(listBranches(conv.id).length, 0);
  });
} finally {
  deleteConversation(conv.id);
}

console.log(`\n${passed} tests passed.`);
