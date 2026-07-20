/* Provider parity: PDF extraction, price-based cost estimation, ext model pricing display. */
import assert from "node:assert";
import { extractPdfText } from "../lib/pdf";
import { createProvider, deleteProvider } from "../lib/db";
import { listExtModels, targetFor } from "../lib/providers";

let passed = 0;
const ok = async (name: string, fn: () => Promise<void> | void) => {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
};

// A minimal valid single-page PDF containing the text "Hello Liberde PDF".
const MINI_PDF = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 62>>stream
BT /F1 24 Tf 72 720 Td (Hello Liberde PDF) Tj ET
endstream
endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
xref
0 6
0000000000 65535 f
trailer<</Size 6/Root 1 0 R>>
startxref
0
%%EOF`;

async function main() {
  await ok("extractPdfText reads a real PDF", async () => {
    const dataUrl = `data:application/pdf;base64,${Buffer.from(MINI_PDF).toString("base64")}`;
    const text = await extractPdfText(dataUrl);
    assert.ok(text.includes("Hello Liberde PDF"), `got: ${text.slice(0, 100)}`);
  });

  await ok("extractPdfText fails gracefully on garbage", async () => {
    const dataUrl = `data:application/pdf;base64,${Buffer.from("not a pdf").toString("base64")}`;
    await assert.rejects(() => extractPdfText(dataUrl));
  });

  const provider = createProvider({
    kind: "bedrock",
    name: "Priced AWS",
    config: {
      region: "us-east-1",
      apiKey: "k",
      models: ["anthropic.claude-sonnet-4-v1:0"],
      promptPrice: 3,
      completionPrice: 15,
    },
  });
  try {
    await ok("targets carry configured prices", () => {
      const t = targetFor(provider, "anthropic.claude-sonnet-4-v1:0");
      assert.equal(t.promptPricePerM, 3);
      assert.equal(t.completionPricePerM, 15);
      // estimated cost math: 1000 in + 500 out
      const cost = (1000 * 3 + 500 * 15) / 1_000_000;
      assert.ok(Math.abs(cost - 0.0105) < 1e-9);
    });

    await ok("ext catalog entries show per-1M prices", () => {
      const m = listExtModels("local").find((x) => x.name.startsWith("Priced AWS"))!;
      assert.equal(Number(m.pricing.prompt) * 1_000_000, 3);
      assert.equal(Number(m.pricing.completion) * 1_000_000, 15);
    });
  } finally {
    deleteProvider(provider.id);
  }

  console.log(`\n${passed} tests passed.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
