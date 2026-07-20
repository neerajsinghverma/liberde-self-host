/* User-edit artifact versions + unified search unit tests. */
import assert from "node:assert";
import {
  addArtifactVersion,
  addMessage,
  createConversation,
  createProject,
  deleteConversation,
  deleteProject,
  getArtifactByIdentifier,
  getArtifactVersion,
  listArtifactVersions,
  searchAll,
} from "../lib/db";
import { processAssistantArtifacts } from "../lib/artifacts";

let passed = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
};

const conv = createConversation("test/model");
const project = createProject("Quokka Analytics", "Analyze quokka populations");
try {
  ok("user edits create versions with null message_id", () => {
    const msg = addMessage(
      conv.id,
      "assistant",
      `<liberdeArtifact identifier="doc" command="create" type="markdown" title="Doc">\n# Hello\n</liberdeArtifact>`
    );
    processAssistantArtifacts(conv.id, msg.id, msg.content);
    const art = getArtifactByIdentifier(conv.id, "doc")!;
    const v2 = addArtifactVersion(art.id, "# Hello (edited by user)", null);
    assert.equal(v2.version, 2);
    assert.equal(v2.message_id, null);
    assert.equal(getArtifactVersion(art.id)!.content, "# Hello (edited by user)");
    assert.equal(listArtifactVersions(art.id).length, 2);
  });

  ok("searchAll finds projects and artifacts", () => {
    const results = searchAll("quokka");
    assert.ok(results.projects.some((p) => p.id === project.id));
    const artResults = searchAll("Hello (edited by user)");
    assert.ok(artResults.artifacts.some((a) => a.identifier === "doc"));
  });
} finally {
  deleteConversation(conv.id);
  deleteProject(project.id);
}

console.log(`\n${passed} tests passed.`);
