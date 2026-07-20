/* Slides artifact tests: parsing, storage, deck chrome, publish flow. */
import assert from "node:assert";
import { parseArtifactBlocks } from "../lib/artifact-shared";
import { buildSlidesSrcDoc, buildSrcDoc } from "../lib/artifact-srcdoc";
import { processAssistantArtifacts } from "../lib/artifacts";
import {
  addMessage,
  createConversation,
  deleteConversation,
  getArtifactByIdentifier,
  getArtifactVersion,
  setArtifactShare,
  getArtifactByShareId,
} from "../lib/db";

let passed = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
};

const DECK = `<style>.slide{background:#1a1a2e;color:#fff}h1{font-size:3rem}</style>
<section class="slide"><h1>LLM Basics</h1><p>An introduction</p></section>
<section class="slide"><h2>Agenda</h2><ul><li>Tokens</li><li>Training</li></ul></section>
<section class="slide"><h2>Thanks!</h2></section>`;

console.log("Slides:");

ok("parser accepts the slides type", () => {
  const blocks = parseArtifactBlocks(
    `<liberdeArtifact identifier="deck" command="create" type="slides" title="LLM Basics">\n${DECK}\n</liberdeArtifact>`
  );
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, "slides");
});

ok("deck chrome wraps content with nav, counter and print CSS", () => {
  const doc = buildSlidesSrcDoc(DECK);
  assert.ok(doc.includes("LLM Basics"), "content embedded");
  assert.ok(doc.includes("liberde-ctl"), "nav controls present");
  assert.ok(doc.includes("lb-count"), "slide counter present");
  assert.ok(doc.includes("page-break-after"), "print pagination present");
  assert.ok(doc.includes("ArrowRight"), "keyboard nav present");
});

ok("buildSrcDoc routes slides to the deck chrome", () => {
  assert.ok(buildSrcDoc("slides", DECK)!.includes("liberde-deck"));
  assert.equal(buildSrcDoc("code", "x"), null);
});

const conv = createConversation("test/model");
try {
  ok("slides artifacts store and publish like any other type", () => {
    const msg = addMessage(
      conv.id,
      "assistant",
      `<liberdeArtifact identifier="deck" command="create" type="slides" title="LLM Basics">\n${DECK}\n</liberdeArtifact>`
    );
    processAssistantArtifacts(conv.id, msg.id, msg.content);
    const art = getArtifactByIdentifier(conv.id, "deck")!;
    assert.equal(art.type, "slides");
    assert.ok(getArtifactVersion(art.id)!.content.includes('<section class="slide">'));
    setArtifactShare(art.id, { share_id: "slidetest", share_mode: "latest", pinned_version: null });
    assert.equal(getArtifactByShareId("slidetest")!.type, "slides");
  });
} finally {
  deleteConversation(conv.id);
}

console.log(`\n${passed} tests passed.`);
