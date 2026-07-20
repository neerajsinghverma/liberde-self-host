/* End-to-end test of the artifact engine: parse → create → update → rewrite →
   versioning → publish → share resolution → remix-style reseed → pruning. */
import assert from "node:assert";
import {
  parseArtifactBlocks,
  applyReplacements,
  splitContentSegments,
} from "../lib/artifact-shared";
import { processAssistantArtifacts } from "../lib/artifacts";
import {
  addMessage,
  createConversation,
  deleteConversation,
  deleteMessagesFrom,
  getArtifactByIdentifier,
  getArtifactByShareId,
  getArtifactVersion,
  listArtifacts,
  listArtifactVersions,
  setArtifactShare,
} from "../lib/db";

let passed = 0;
function ok(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

console.log("Parser:");

ok("parses a create block with attributes", () => {
  const text = `Here you go!\n<liberdeArtifact identifier="my-page" command="create" type="html" title="My Page">\n<h1>Hi</h1>\n</liberdeArtifact>\nEnjoy.`;
  const blocks = parseArtifactBlocks(text);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].identifier, "my-page");
  assert.equal(blocks[0].type, "html");
  assert.equal(blocks[0].content, "<h1>Hi</h1>");
});

ok("strips an accidental markdown fence", () => {
  const text = `<liberdeArtifact identifier="x" type="code" language="python" title="T">\n\`\`\`python\nprint(1)\n\`\`\`\n</liberdeArtifact>`;
  assert.equal(parseArtifactBlocks(text)[0].content, "print(1)");
});

ok("parses update replacements", () => {
  const text = `<liberdeArtifact identifier="my-page" command="update">\n<liberdeOld>Hi</liberdeOld>\n<liberdeNew>Hello</liberdeNew>\n<liberdeOld>foo</liberdeOld>\n<liberdeNew>bar</liberdeNew>\n</liberdeArtifact>`;
  const b = parseArtifactBlocks(text)[0];
  assert.equal(b.command, "update");
  assert.equal(b.replacements.length, 2);
  assert.deepEqual(b.replacements[0], { oldStr: "Hi", newStr: "Hello" });
});

ok("applyReplacements applies matches and skips misses", () => {
  const { content, applied } = applyReplacements("a b c", [
    { oldStr: "b", newStr: "B" },
    { oldStr: "zzz", newStr: "x" },
  ]);
  assert.equal(content, "a B c");
  assert.equal(applied, 1);
});

ok("splitContentSegments handles text + block + streaming tail", () => {
  const text = `Intro\n<liberdeArtifact identifier="a" type="svg" title="A">\n<svg/>\n</liberdeArtifact>\nMiddle\n<liberdeArtifact identifier="b" type="html" title="B">\n<h1>partial...`;
  const segs = splitContentSegments(text);
  assert.deepEqual(
    segs.map((s) => s.kind),
    ["text", "artifact", "text", "streaming-artifact"]
  );
  assert.equal(segs[3].partial?.identifier, "b");
  assert.ok(segs[3].partial?.content.includes("<h1>partial"));
});

console.log("Engine (SQLite):");

const conv = createConversation("test/model");
try {
  ok("create produces artifact v1", () => {
    const m = addMessage(conv.id, "assistant", `<liberdeArtifact identifier="dash" command="create" type="html" title="Dashboard">\n<h1>Hello</h1>\n<p>World</p>\n</liberdeArtifact>`);
    const n = processAssistantArtifacts(conv.id, m.id, m.content);
    assert.equal(n, 1);
    const a = getArtifactByIdentifier(conv.id, "dash")!;
    assert.equal(a.title, "Dashboard");
    assert.equal(getArtifactVersion(a.id)!.version, 1);
    assert.ok(getArtifactVersion(a.id)!.content.includes("<h1>Hello</h1>"));
  });

  ok("update str-replace produces v2", () => {
    const m = addMessage(conv.id, "assistant", `<liberdeArtifact identifier="dash" command="update">\n<liberdeOld><h1>Hello</h1></liberdeOld>\n<liberdeNew><h1>Hello, Liberde</h1></liberdeNew>\n</liberdeArtifact>`);
    const n = processAssistantArtifacts(conv.id, m.id, m.content);
    assert.equal(n, 1);
    const a = getArtifactByIdentifier(conv.id, "dash")!;
    const latest = getArtifactVersion(a.id)!;
    assert.equal(latest.version, 2);
    assert.ok(latest.content.includes("Hello, Liberde"));
    assert.ok(latest.content.includes("<p>World</p>"), "untouched parts preserved");
  });

  ok("failed update (no match) writes no version", () => {
    const m = addMessage(conv.id, "assistant", `<liberdeArtifact identifier="dash" command="update">\n<liberdeOld>DOES NOT EXIST</liberdeOld>\n<liberdeNew>x</liberdeNew>\n</liberdeArtifact>`);
    const n = processAssistantArtifacts(conv.id, m.id, m.content);
    assert.equal(n, 0);
    const a = getArtifactByIdentifier(conv.id, "dash")!;
    assert.equal(getArtifactVersion(a.id)!.version, 2);
  });

  ok("rewrite produces v3 with full replacement", () => {
    const m = addMessage(conv.id, "assistant", `<liberdeArtifact identifier="dash" command="rewrite" type="html" title="Dashboard v2">\n<main>rebuilt</main>\n</liberdeArtifact>`);
    processAssistantArtifacts(conv.id, m.id, m.content);
    const a = getArtifactByIdentifier(conv.id, "dash")!;
    assert.equal(a.title, "Dashboard v2");
    const latest = getArtifactVersion(a.id)!;
    assert.equal(latest.version, 3);
    assert.equal(latest.content, "<main>rebuilt</main>");
  });

  ok("publish latest + pinned resolution", () => {
    const a = getArtifactByIdentifier(conv.id, "dash")!;
    setArtifactShare(a.id, { share_id: "testshare", share_mode: "latest", pinned_version: null });
    assert.equal(getArtifactByShareId("testshare")!.resolved!.version, 3);
    setArtifactShare(a.id, { share_id: "testshare", share_mode: "pinned", pinned_version: 2 });
    assert.equal(getArtifactByShareId("testshare")!.resolved!.version, 2);
    assert.ok(getArtifactByShareId("testshare")!.resolved!.content.includes("Hello, Liberde"));
  });

  ok("editing history prunes orphaned versions", () => {
    const doomed = addMessage(conv.id, "assistant", `<liberdeArtifact identifier="temp-art" command="create" type="code" language="py" title="Temp">\nprint(1)\n</liberdeArtifact>`);
    processAssistantArtifacts(conv.id, doomed.id, doomed.content);
    assert.ok(getArtifactByIdentifier(conv.id, "temp-art"));
    deleteMessagesFrom(conv.id, doomed.id);
    assert.equal(getArtifactByIdentifier(conv.id, "temp-art"), undefined);
    // dash survives: its versions came from earlier messages
    const dash = getArtifactByIdentifier(conv.id, "dash")!;
    assert.equal(listArtifactVersions(dash.id).length, 3);
  });

  ok("two artifacts coexist per conversation", () => {
    const m = addMessage(conv.id, "assistant", `<liberdeArtifact identifier="logo" command="create" type="svg" title="Logo">\n<svg></svg>\n</liberdeArtifact>`);
    processAssistantArtifacts(conv.id, m.id, m.content);
    assert.equal(listArtifacts(conv.id).length, 2);
  });
} finally {
  deleteConversation(conv.id);
  assert.equal(listArtifacts(conv.id).length, 0, "cleanup removes artifacts");
}

console.log(`\n${passed} tests passed.`);
