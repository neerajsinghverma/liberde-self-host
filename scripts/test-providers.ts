/* Multi-provider tests: endpoint resolution per cloud, model namespacing, isolation. */
import assert from "node:assert";
import { createProvider, deleteProvider } from "../lib/db";
import {
  EXT_PREFIX,
  listExtModels,
  parseExtModel,
  resolveChatTarget,
  targetFor,
} from "../lib/providers";

let passed = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
};

const cleanup: string[] = [];
try {
  const azure = createProvider(
    {
      kind: "azure",
      name: "Work Azure",
      config: { endpoint: "https://acme.openai.azure.com", apiKey: "az-key", apiVersion: "2024-10-21", models: ["gpt-4o"] },
    }
  );
  cleanup.push(azure.id);
  const bedrock = createProvider(
    { kind: "bedrock", name: "AWS", config: { region: "us-west-2", apiKey: "br-key", models: ["anthropic.claude-sonnet-4-v1:0"] } }
  );
  cleanup.push(bedrock.id);
  const google = createProvider(
    { kind: "google", name: "Gemini", config: { apiKey: "g-key", models: ["gemini-2.5-pro"] } }
  );
  cleanup.push(google.id);

  ok("azure target builds deployment URL with api-key header", () => {
    const t = targetFor(azure, "gpt-4o");
    assert.equal(
      t.url,
      "https://acme.openai.azure.com/openai/deployments/gpt-4o/chat/completions?api-version=2024-10-21"
    );
    assert.equal(t.headers["api-key"], "az-key");
    assert.equal(t.isOpenRouter, false);
  });

  ok("bedrock target uses regional OpenAI-compat endpoint with bearer", () => {
    const t = targetFor(bedrock, "anthropic.claude-sonnet-4-v1:0");
    assert.equal(t.url, "https://bedrock-runtime.us-west-2.amazonaws.com/openai/v1/chat/completions");
    assert.equal(t.headers.Authorization, "Bearer br-key");
  });

  ok("google target defaults to Gemini OpenAI-compat", () => {
    const t = targetFor(google, "gemini-2.5-pro");
    assert.equal(t.url, "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
  });

  ok("ext model ids namespace and parse round-trip", () => {
    const models = listExtModels("local");
    assert.equal(models.length, 3);
    const id = models[0].id;
    assert.ok(id.startsWith(EXT_PREFIX));
    const parsed = parseExtModel(id)!;
    assert.ok(cleanup.includes(parsed.providerId));
    // model names containing ':' survive (bedrock ids)
    const br = models.find((m) => m.id.includes(bedrock.id))!;
    assert.equal(parseExtModel(br.id)!.model, "anthropic.claude-sonnet-4-v1:0");
  });

  ok("resolveChatTarget routes ext ids and falls back to OpenRouter", () => {
    const models = listExtModels("local");
    const t = resolveChatTarget(models[0].id, "local");
    assert.equal(t.isOpenRouter, false);
    const or = resolveChatTarget("anthropic/claude-sonnet-4", "local");
    assert.equal(or.isOpenRouter, true);
    assert.ok(or.url.includes("openrouter.ai"));
  });

  ok("other users cannot resolve someone else's provider", () => {
    const models = listExtModels("local");
    assert.throws(() => resolveChatTarget(models[0].id, "intruder-user"));
    assert.equal(listExtModels("intruder-user").length, 0);
  });
} finally {
  for (const id of cleanup) deleteProvider(id);
}

console.log(`\n${passed} tests passed.`);
