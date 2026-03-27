import OpenAI from "openai";
import ExcelJS from "exceljs";

async function main() {
  const naf = process.argv[2] || "62.01Z";
  const departement = process.argv[3] || "75";
  const limit = Number(process.argv[4] || "5");

  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  const response = await client.responses.create({
    model: "gpt-5.4",


    input: `

Trouve ${limit} entreprises correspondant au code NAF ${naf} dans le département ${departement}.

Tu dois obligatoirement exécuter ces outils dans cet ordre :
1. sirene_search
2. lead_score
3. lead_enrich_rncs
4. lead_signals_bodacc
5. lead_email

Important :
- n'utilise pas lead_pipeline
- ne fabrique aucun résultat
- si aucun résultat n'est trouvé, retourne un tableau JSON vide []
- retourne uniquement un JSON final

Chaque objet doit contenir :
- siren
- nom
- score
- priorite
- dirigeant_nom
- dirigeant_fonction
- signal
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

  data.sort((a, b) => (b.score || 0) - (a.score || 0));

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Leads");

  worksheet.columns = [
    { header: "SIREN", key: "siren", width: 15 },
    { header: "Nom", key: "nom", width: 30 },
    { header: "Score", key: "score", width: 10 },
    { header: "Priorité", key: "priorite", width: 15 },
    { header: "Dirigeant", key: "dirigeant_nom", width: 25 },
    { header: "Fonction", key: "dirigeant_fonction", width: 20 },
    { header: "Signal", key: "signal", width: 25 },
    { header: "Statut", key: "statut", width: 20 },
    { header: "Message", key: "message", width: 80 }
  ];

  worksheet.views = [{ state: "frozen", ySplit: 1 }];

  data.forEach(row => {
    worksheet.addRow({
      ...row,
      dirigeant_nom: row.dirigeant_nom || "",
      dirigeant_fonction: row.dirigeant_fonction || "",
      signal: row.signal || "",
      priorite: row.priorite || "",
      statut: "À contacter"
    });
  });

  worksheet.getRow(1).font = { bold: true };
  worksheet.getColumn("message").alignment = { wrapText: true };

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `leads-${naf}-${departement}-${timestamp}.xlsx`;

  await workbook.xlsx.writeFile(filename);

  console.log(`✅ Fichier Excel généré : ${filename}`);
}

main().catch((error) => {
  console.error("❌ Erreur :", error);
  process.exit(1);
});