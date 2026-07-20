#!/usr/bin/env node
/**
 * Liberde CLI — terminal chat client for a Liberde server.
 *
 * Setup:   liberde config --server http://localhost:3000 --key lbd-...
 * Chat:    liberde                      (interactive REPL)
 * One-off: liberde -p "explain CORS"    (prints answer, exits)
 * Models:  liberde models [filter]
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

const CONFIG_PATH = path.join(os.homedir(), ".liberde", "config.json");

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
  } catch {
    return {};
  }
}

function saveConfig(config) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-p" || a === "--prompt") args.prompt = argv[++i];
    else if (a === "--server") args.server = argv[++i];
    else if (a === "--key") args.key = argv[++i];
    else if (a === "-m" || a === "--model") args.model = argv[++i];
    else if (a === "-h" || a === "--help") args.help = true;
    else args._.push(a);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const config = loadConfig();
const server = (args.server || config.server || "http://localhost:3000").replace(/\/$/, "");
const key = args.key || config.key || "";
const model = args.model || config.model || "";

const HELP = `Liberde CLI

Usage:
  liberde                          Interactive chat
  liberde -p "question"            One-shot question
  liberde -m provider/model ...    Override model
  liberde models [filter]          List available models
  liberde config --server URL --key lbd-... [-m model]
                                   Save connection settings

In chat: /model <id> switches model, /clear resets context, /exit quits.
Current server: ${server}${key ? "" : "   (no API key configured!)"}`;

async function chatOnce(messages, modelOverride, onDelta) {
  const res = await fetch(`${server}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      ...(modelOverride ? { model: modelOverride } : {}),
      messages,
      stream: true,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Server error ${res.status}: ${text.slice(0, 300)}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6).trim();
      if (payload === "[DONE]") continue;
      try {
        const parsed = JSON.parse(payload);
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) {
          full += delta;
          onDelta(delta);
        }
        if (parsed.error) throw new Error(parsed.error.message || String(parsed.error));
      } catch (e) {
        if (e instanceof SyntaxError) continue;
        throw e;
      }
    }
  }
  return full;
}

async function main() {
  const command = args._[0];

  if (args.help || command === "help") {
    console.log(HELP);
    return;
  }

  if (command === "config") {
    const next = { ...config };
    if (args.server) next.server = args.server.replace(/\/$/, "");
    if (args.key) next.key = args.key;
    if (args.model) next.model = args.model;
    saveConfig(next);
    console.log(`Saved to ${CONFIG_PATH}`);
    console.log(JSON.stringify({ ...next, key: next.key ? next.key.slice(0, 10) + "…" : "" }, null, 2));
    return;
  }

  if (!key) {
    console.error("No API key configured. Create one in Liberde Settings → Platform API keys, then run:");
    console.error(`  liberde config --server ${server} --key lbd-...`);
    process.exit(1);
  }

  if (command === "models") {
    const res = await fetch(`${server}/v1/models`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) throw new Error(`Server error ${res.status}`);
    const data = await res.json();
    const filter = (args._[1] || "").toLowerCase();
    for (const m of data.data) {
      if (!filter || m.id.toLowerCase().includes(filter)) console.log(m.id);
    }
    return;
  }

  if (args.prompt) {
    await chatOnce([{ role: "user", content: args.prompt }], model, (d) =>
      process.stdout.write(d)
    );
    process.stdout.write("\n");
    return;
  }

  // Interactive REPL
  console.log(`Liberde — connected to ${server}${model ? ` (${model})` : ""}`);
  console.log("Type /exit to quit, /clear to reset, /model <id> to switch models.\n");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const messages = [];
  let currentModel = model;

  const ask = () =>
    rl.question("you> ", async (line) => {
      const input = line.trim();
      if (!input) return ask();
      if (input === "/exit" || input === "/quit") return rl.close();
      if (input === "/clear") {
        messages.length = 0;
        console.log("(context cleared)\n");
        return ask();
      }
      if (input.startsWith("/model")) {
        currentModel = input.split(/\s+/)[1] || "";
        console.log(`(model: ${currentModel || "server default"})\n`);
        return ask();
      }
      messages.push({ role: "user", content: input });
      process.stdout.write("\nliberde> ");
      try {
        const reply = await chatOnce(messages, currentModel, (d) => process.stdout.write(d));
        messages.push({ role: "assistant", content: reply });
        process.stdout.write("\n\n");
      } catch (e) {
        messages.pop();
        console.error(`\n[error] ${e.message}\n`);
      }
      ask();
    });
  ask();
}

main().catch((e) => {
  console.error(`[error] ${e.message}`);
  process.exit(1);
});
