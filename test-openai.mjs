import OpenAI from "openai";
import ExcelJS from "exceljs";

async function main() {
  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  const response = await client.responses.create({
    model: "gpt-5.4",



input: `
Trouve 5 entreprises en développement informatique (62.01Z) dans le département 75.

Tu dois obligatoirement exécuter ces outils dans cet ordre :
1. sirene_search
2. lead_score
3. lead_enrich_rncs
4. lead_email

Important :
- ne saute aucune étape
- utilise le résultat de lead_enrich_rncs avant lead_email
- retourne un JSON final uniquement
- chaque objet doit contenir :
  - siren
  - nom
  - score
  - dirigeant_nom
  - dirigeant_fonction
  - message
`,



    tools: [
      {
        type: "mcp",
        server_label: "mon-mcp",
        server_url: "https://mon-mcp.onrender.com/mcp",
        require_approval: "never"
      }
    ]
  });

  console.log("\n--- OUTPUT TEXT ---\n");
  console.log(response.output_text);

  function extractJSON(text) {
    try {
      const match = text.match(/\[.*\]/s);
      if (match) return JSON.parse(match[0]);
    } catch {}
    return null;
  }

  const data = extractJSON(response.output_text);

  if (!data) {
    console.log("❌ Impossible d'extraire le JSON");
    process.exit(1);
  }

  data.sort((a, b) => b.score - a.score);

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Leads");

  worksheet.columns = [
    { header: "SIREN", key: "siren", width: 15 },
    { header: "Nom", key: "nom", width: 30 },
    { header: "Score", key: "score", width: 10 },
    { header: "Statut", key: "statut", width: 20 },
    { header: "Message", key: "message", width: 80 }
  ];

  worksheet.views = [{ state: "frozen", ySplit: 1 }];

  data.forEach(row => {
    worksheet.addRow({
      ...row,
      statut: "À contacter"
    });
  });

  worksheet.getRow(1).font = { bold: true };
  worksheet.getColumn("message").alignment = { wrapText: true };

  await workbook.xlsx.writeFile("leads.xlsx");

  console.log("✅ Fichier Excel généré : leads.xlsx");
}

main().catch((error) => {
  console.error("❌ Erreur :", error);
  process.exit(1);
});
