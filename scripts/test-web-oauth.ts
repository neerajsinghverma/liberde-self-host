/* Tests: built-in web tools + MCP OAuth provider persistence. */
import assert from "node:assert";
import {
  BUILTIN_TOOL_DEFS,
  execBuiltinTool,
  isBuiltinTool,
} from "../lib/builtin-tools";
import { makeOAuthProvider, parseOAuthState } from "../lib/mcp-oauth";
import {
  createConnector,
  deleteConnector,
  getConnectorOAuth,
} from "../lib/db";

let passed = 0;
const ok = async (name: string, fn: () => Promise<void> | void) => {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
};

async function main() {
  console.log("Built-in web tools:");

  await ok("tool defs are valid", () => {
    assert.equal(BUILTIN_TOOL_DEFS.length, 2);
    for (const t of BUILTIN_TOOL_DEFS) {
      assert.match(t.function.name, /^[a-zA-Z0-9_-]{1,64}$/);
      assert.ok(isBuiltinTool(t.function.name));
    }
    assert.ok(!isBuiltinTool("everything__echo"));
  });

  await ok("fetch_page reads a live public page", async () => {
    const { output, annotations } = await execBuiltinTool(
      "fetch_page",
      JSON.stringify({ url: "https://example.com/" })
    );
    assert.ok(!output.startsWith("Error"), output.slice(0, 120));
    assert.ok(output.toLowerCase().includes("example"));
    assert.equal(annotations.length, 1);
  });

  await ok("fetch_page rejects non-http URLs", async () => {
    const { output } = await execBuiltinTool(
      "fetch_page",
      JSON.stringify({ url: "file:///etc/passwd" })
    );
    assert.ok(output.startsWith("Error"));
  });

  await ok("SSRF guard blocks localhost, private and link-local ranges", async () => {
    for (const url of [
      "http://localhost:3210/",
      "http://127.0.0.1/",
      "http://10.0.0.5/x",
      "http://192.168.1.1/",
      "http://169.254.169.254/latest/meta-data/",
      "http://172.20.3.4/admin",
    ]) {
      const { output } = await execBuiltinTool("fetch_page", JSON.stringify({ url }));
      assert.ok(output.startsWith("Error"), `${url} was not blocked: ${output.slice(0, 80)}`);
      assert.ok(output.includes("Blocked"), `${url}: ${output.slice(0, 80)}`);
    }
  });

  await ok("web_search fails gracefully without an API key", async () => {
    const { output } = await execBuiltinTool(
      "web_search",
      JSON.stringify({ query: "test" })
    );
    // No OpenRouter key configured on this box → upstream 401, reported as Error text.
    assert.ok(output.startsWith("Error"), output.slice(0, 120));
  });

  await ok("bad JSON args fail gracefully", async () => {
    const { output } = await execBuiltinTool("web_search", "{nope");
    assert.ok(output.startsWith("Error"));
  });

  console.log("MCP OAuth provider:");

  const connector = createConnector({
    name: "oauth-test",
    transport: "http",
    url: "https://example.com/mcp",
  });
  try {
    const provider = makeOAuthProvider(connector.id);

    await ok("state() saves a nonce and pins the redirect URL", () => {
      const state = provider.state!() as string;
      const parsed = parseOAuthState(state)!;
      assert.equal(parsed.connectorId, connector.id);
      const data = getConnectorOAuth(connector.id);
      assert.equal(data.state_nonce, parsed.nonce);
      assert.ok(String(data.redirect_url).endsWith("/api/oauth/callback"));
    });

    await ok("client info, tokens, verifier roundtrip through SQLite", () => {
      provider.saveClientInformation({
        client_id: "abc123",
        redirect_uris: [provider.redirectUrl as string],
      } as Parameters<typeof provider.saveClientInformation>[0]);
      assert.equal(provider.clientInformation()!.client_id, "abc123");
      provider.saveTokens({ access_token: "tok", token_type: "Bearer" });
      assert.equal(provider.tokens()!.access_token, "tok");
      provider.saveCodeVerifier("verif-1");
      assert.equal(provider.codeVerifier(), "verif-1");
    });

    await ok("redirectToAuthorization captures the URL", () => {
      provider.redirectToAuthorization(new URL("https://auth.example.com/authorize?x=1"));
      assert.equal(provider.pendingAuthUrl, "https://auth.example.com/authorize?x=1");
      assert.equal(
        getConnectorOAuth(connector.id).pending_auth_url,
        "https://auth.example.com/authorize?x=1"
      );
    });

    await ok("invalidateCredentials('all') clears secrets", () => {
      provider.invalidateCredentials!("all");
      assert.equal(provider.tokens(), undefined);
      assert.equal(provider.clientInformation(), undefined);
    });

    await ok("parseOAuthState rejects malformed state", () => {
      assert.equal(parseOAuthState("no-dot-here"), null);
    });
  } finally {
    deleteConnector(connector.id);
  }

  console.log(`\n${passed} tests passed.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
