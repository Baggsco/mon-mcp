import OpenAI from "openai";

async function main() {
  const q =
    process.argv[2] ||
    "codeCommuneEtablissement:49127";

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

Règles strictes :
- appelle le tool avec les arguments structurés exacts
- passe q comme chaîne brute, sans ajouter de guillemets autour de toute l'expression
- ne fabrique aucune donnée
- ne modifie pas les résultats
- retourne uniquement le JSON du tool
        `.trim(),
      },
      {
        role: "user",
        content: JSON.stringify({
          tool: "search_establishments",
          arguments: {
            q,
            limit,
          },
        }),
      },
    ],
  });

  console.log(response.output_text);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});