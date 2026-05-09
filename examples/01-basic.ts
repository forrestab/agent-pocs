import { getModel, completeSimple } from "@earendil-works/pi-ai";

const model = getModel("openrouter", "google/gemma-4-31b-it:free");

const response = await completeSimple(model, {
    systemPrompt: "You are a helpful assistant.",
    messages: [
        { role: "user", content: "What is a homelab in one sentence?", timestamp: Date.now() }
    ]
});

for (const block of response.content) {
    if (block.type === "text") console.log(block.text);
}
