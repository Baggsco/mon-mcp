import OpenAI from "openai";

async function main() {
  const q =
    process.argv[2] ||
    'etatAdministratifEtablissement:A AND codeCommuneEtablissement:49127';

  const limit = Number(process.argv[3] || "5");

  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  const response = await client.responses.create({
    model: "gpt-5",
    tools: [
      {
        type: "mcp",
        server_label: "sirene",
        server_url: "https://mon-mcp.onrender.com/mcp",
        require_approval: "never",
      },
    ],
    input: [
      {
        role: "system",
        content: `
Utilise uniquement le tool MCP search_establishments.
Ne fabrique aucune donnée.
Ne modifie pas les résultats.
Retourne uniquement le JSON du tool.
Chaque résultat doit correspondre à un établissement identifié par un SIRET distinct.
        `.trim(),
      },
      {
        role: "user",
        content: `search_establishments avec q="${q}" et limit=${limit}`,
      },
    ],
  });

  console.log(response.output_text);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});