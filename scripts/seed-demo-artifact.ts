/* Seed a demo conversation with a working HTML artifact (two versions) for runtime testing. */
import { addMessage, createConversation } from "../lib/db";
import { processAssistantArtifacts } from "../lib/artifacts";

const conv = createConversation("anthropic/claude-sonnet-4");

const v1 = addMessage(
  conv.id,
  "assistant",
  `I built you a color-cycling demo page.

<liberdeArtifact identifier="pulse-demo" command="create" type="html" title="Pulse Demo">
<!doctype html>
<html><head><meta charset="utf-8"><title>Pulse</title>
<style>body{margin:0;display:grid;place-items:center;height:100vh;font-family:sans-serif;transition:background .5s}h1{color:#fff;font-size:3rem}</style>
</head><body><h1 id="t">Liberde</h1>
<script>
const colors=['#c96442','#2563eb','#059669','#7c3aed'];let i=0;
setInterval(()=>{document.body.style.background=colors[i++%colors.length]},900);
</script></body></html>
</liberdeArtifact>

Click it to preview.`
);
processAssistantArtifacts(conv.id, v1.id, v1.content);

const v2 = addMessage(
  conv.id,
  "assistant",
  `Sped it up.

<liberdeArtifact identifier="pulse-demo" command="update">
<liberdeOld>},900);</liberdeOld>
<liberdeNew>},300);</liberdeNew>
</liberdeArtifact>`
);
processAssistantArtifacts(conv.id, v2.id, v2.content);

console.log(JSON.stringify({ conversationId: conv.id }));
