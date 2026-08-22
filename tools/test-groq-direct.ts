import fs from "node:fs";

async function main() {
  const key = process.env.GROQ_API_KEY;
  const s2003 = fs.readFileSync("/tmp/spot_lote_355.png"); // or small buffer
  const b64 = "data:image/png;base64," + s2003.toString("base64");

  console.log("Chamando Groq com 1 imagem e response_format json_object...");
  const t0 = Date.now();
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "qwen/qwen3.6-27b",
      reasoning_effort: "none",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "Você é um analista GIS. Responda estritamente em JSON com o schema {\"observations\": [{\"year\": 2008, \"state\": \"ANTHROPIZED\"}]}" },
        {
          role: "user",
          content: [
            { type: "text", text: "Analise a cena de 2008." },
            { type: "image_url", image_url: { url: b64 } }
          ]
        }
      ]
    })
  });

  console.log("Status:", res.status, res.statusText);
  const data = await res.json();
  console.log("Tempo:", Date.now() - t0, "ms");
  console.log("Data:", JSON.stringify(data, null, 2));
}

main().catch(console.error);
