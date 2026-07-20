import { NextRequest } from "next/server";
import { getRequestUserId, unauthorized } from "@/lib/auth";
import { addMessage, getApiKey, getConversation } from "@/lib/db";
import { getSettings, openRouterHeaders, OPENROUTER_BASE } from "@/lib/openrouter";

export const runtime = "nodejs";

/** Generate an image via OpenRouter's Image API and record it in the conversation. */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  const conversation = getConversation(body.conversationId);
  if (!conversation || (conversation.user_id && conversation.user_id !== userId)) return Response.json({ error: "Conversation not found" }, { status: 404 });
  if (!getApiKey(userId)) {
    return Response.json(
      { error: "No OpenRouter API key configured. Add one in Settings." },
      { status: 400 }
    );
  }
  const prompt = (body.prompt ?? "").trim();
  if (!prompt) return Response.json({ error: "prompt is required" }, { status: 400 });

  const model = body.model || getSettings(userId).imageModel;
  addMessage(conversation.id, "user", prompt);

  const upstream = await fetch(`${OPENROUTER_BASE}/images`, {
    method: "POST",
    headers: openRouterHeaders(userId),
    body: JSON.stringify({ model, prompt }),
    signal: req.signal,
  });
  if (!upstream.ok) {
    const detail = await upstream.text();
    return Response.json(
      { error: `Image generation failed (${upstream.status}): ${detail.slice(0, 400)}` },
      { status: 502 }
    );
  }
  const data = await upstream.json();
  const images: string[] = (data.data ?? [])
    .filter((d: { b64_json?: string }) => d.b64_json)
    .map(
      (d: { b64_json: string; media_type?: string }) =>
        `data:${d.media_type || "image/png"};base64,${d.b64_json}`
    );
  if (images.length === 0) {
    return Response.json({ error: "The model returned no image." }, { status: 502 });
  }

  const saved = addMessage(
    conversation.id,
    "assistant",
    `Generated image for: "${prompt}"`,
    model,
    null,
    { images, cost: Number(data.usage?.cost) || null }
  );
  return Response.json({ message: saved }, { status: 201 });
}
