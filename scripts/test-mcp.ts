/* MCP + skills verification: live stdio server, tool assembly, skill loading, tool calls. */
import assert from "node:assert";
import {
  createConnector,
  createSkill,
  deleteConnector,
  deleteSkill,
} from "../lib/db";
import { assembleTools, callTool, dropConnection, testConnector } from "../lib/mcp";

let passed = 0;
const ok = async (name: string, fn: () => Promise<void> | void) => {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
};

async function main() {
const connector = createConnector({
  name: "everything",
  transport: "stdio",
  command: "npx",
  args: JSON.stringify(["-y", "@modelcontextprotocol/server-everything"]),
});
const skill = createSkill({
  name: "Test skill",
  description: "A test skill",
  instructions: "Step 1: do the thing.\nStep 2: verify the thing.",
});

try {
  await ok("live stdio MCP server connects and lists tools", async () => {
    const result = await testConnector(connector);
    assert.ok(result.ok, `connection failed: ${result.error}`);
    assert.ok((result.toolCount ?? 0) > 0, "no tools listed");
    assert.ok(result.tools!.includes("echo"), "expected the echo tool");
  });

  let echoName = "";

  await ok("assembleTools namespaces MCP tools uniquely and includes skills", async () => {
    const { tools, errors } = await assembleTools();
    assert.equal(errors.length, 0, errors.join("; "));
    const echo = tools.find((t) => t.function.name.endsWith("__echo"));
    assert.ok(echo, "echo tool present");
    echoName = echo!.function.name;
    assert.ok(echoName.startsWith("everything_"), `prefix: ${echoName}`);
    assert.ok(tools.some((t) => t.function.name.startsWith("skill__")));
    const skillTool = tools.find((t) => t.function.name.startsWith("skill__"))!;
    assert.ok(skillTool.function.description.includes("Test skill"));
  });

  await ok("callTool executes a real MCP tool", async () => {
    const output = await callTool(echoName, JSON.stringify({ message: "hello liberde" }));
    assert.ok(output.includes("hello liberde"), `unexpected output: ${output}`);
  });

  await ok("assembled tool schemas are valid function defs", async () => {
    const { tools } = await assembleTools();
    for (const t of tools) {
      assert.equal(t.type, "function");
      assert.match(t.function.name, /^[a-zA-Z0-9_-]{1,64}$/);
      assert.ok(t.function.parameters && typeof t.function.parameters === "object");
    }
  });

  await ok("skill invocation returns instructions", async () => {
    const { tools } = await assembleTools();
    const skillTool = tools.find((t) => t.function.name.startsWith("skill__"))!;
    const output = await callTool(skillTool.function.name, "{}");
    assert.ok(output.includes("Step 1: do the thing."));
    assert.ok(output.includes("# Skill: Test skill"));
  });

  await ok("unknown tool fails gracefully", async () => {
    const output = await callTool("nonexistent__tool", "{}");
    assert.ok(output.startsWith("Error"));
  });

  await ok("bad JSON args fail gracefully", async () => {
    const output = await callTool("everything__echo", "{not json");
    assert.ok(output.startsWith("Error"));
  });
} finally {
  dropConnection(connector.id);
  deleteConnector(connector.id);
  deleteSkill(skill.id);
}

console.log(`\n${passed} tests passed.`);
process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
