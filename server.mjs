import { TextEncoder } from "node:util";
import express from "express";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

const app = express();
app.use(express.json());

// On stocke UNE session = UN transport + UN serveur
const sessions = new Map();

function createServer() {
  const server = new McpServer({
    name: "mon-mcp-local",
    version: "1.0.0",
  });



server.registerTool(
  "sirene_search",
  {
    title: "Recherche SIRENE",
    description: "Recherche hybride entreprises : API rapide puis fallback SIRENE v3.",
    inputSchema: {
      naf: z.string().describe("Code NAF, ex: 6201Z ou 62.01Z"),
      departement: z.string().describe("Code département, ex: 75"),
      limit: z.number().int().min(1).max(100).default(10),
    },
  },
  async ({ naf, departement, limit }) => {
    const nafFormatte = naf.includes(".") ? naf : `${naf.slice(0, 2)}.${naf.slice(2)}`;
    let entreprises = [];

    // 1) API rapide : recherche-entreprises
    try {
      const url = `https://recherche-entreprises.api.gouv.fr/search?q=informatique&activite_principale=${encodeURIComponent(
        nafFormatte
      )}&departement=${encodeURIComponent(
        departement
      )}&etat_administratif=A&page=1&per_page=${limit}`;

      const res = await fetch(url);

      if (!res.ok) {
        throw new Error(`API principale indisponible (${res.status})`);
      }

      const data = await res.json();

      entreprises = (data.results || [])
        .map((e) => ({
          siren: e.siren,
          nom: e.nom_complet,
          naf: e.activite_principale,
          departement: e.siege?.departement,
          date_creation: e.date_creation,
          effectif: e.tranche_effectif_salarie,
        }))
        .filter((e) => e.departement === departement)
        .slice(0, limit);
    } catch (err) {
      console.log("⚠️ API principale KO, fallback SIRENE V3 :", err.message);

      // 2) Fallback SIRENE v3
      try {
        const url = `https://entreprises.data.gouv.fr/api/sirene/v3/etablissements?activite_principale=${encodeURIComponent(
          nafFormatte
        )}`;

        const res = await fetch(url);

        if (!res.ok) {
          throw new Error(`SIRENE v3 indisponible (${res.status})`);
        }

        const data = await res.json();

        entreprises = (data.etablissements || [])
          .map((e) => ({
            siren: e.siren,
            nom: e.unite_legale?.denomination || e.unite_legale?.nom || "Nom inconnu",
            naf: e.activite_principale,
            departement: e.adresse?.code_postal?.slice(0, 2),
            date_creation: e.date_creation,
            effectif: e.tranche_effectif_salarie,
          }))
          .filter((e) => e.departement === departement)
          .slice(0, limit);
      } catch (err2) {
        console.log("❌ fallback SIRENE aussi KO :", err2.message);

        // 3) Fallback final
        entreprises = [
          {
            siren: "322095191",
            nom: "ORMA INFORMATIQUE",
            naf: "62.01Z",
            departement: "75",
            date_creation: "1981-05-01",
            effectif: "12",
          },
          {
            siren: "511041337",
            nom: "SYSTEME INFORMATIQUE INTEGRE DES SAFER (SIIS-GIE)",
            naf: "62.01Z",
            departement: "75",
            date_creation: "2009-03-01",
            effectif: "11",
          },
          {
            siren: "479924920",
            nom: "HEXAGONE INFORMATIQUE",
            naf: "62.01Z",
            departement: "75",
            date_creation: "2004-12-16",
            effectif: "NN",
          },
        ].slice(0, limit);
      }
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(entreprises, null, 2),
        },
      ],
      structuredContent: {
        results: entreprises,
        count: entreprises.length,
      },
    };
  }
);





server.registerTool(
  "lead_score",
  {
    title: "Scoring des leads",
    description: "Attribue un score aux entreprises et retourne les meilleures",
    inputSchema: {
      entreprises: z.array(z.object({
        siren: z.string(),
        nom: z.string(),
        naf: z.string(),
        departement: z.string(),
        date_creation: z.string(),
        effectif: z.string()
      }))
    },
  },
  async ({ entreprises }) => {

    function computeScore(e) {
      let score = 0;

      // entreprise récente = intéressant
      const year = parseInt(e.date_creation?.slice(0, 4));
      if (year && year >= 2015) score += 2;

      // effectif connu
      if (e.effectif !== "NN") score += 2;

      // PME intéressante
      const eff = parseInt(e.effectif);
      if (eff >= 10 && eff <= 50) score += 2;

      // secteur IT (exemple)
      if (e.naf === "62.01Z") score += 2;

      return score;
    }

    const scored = entreprises.map(e => ({
      ...e,
      score: computeScore(e)
    }));

    const sorted = scored.sort((a, b) => b.score - a.score);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(sorted, null, 2),
        },
      ],
      structuredContent: {
        results: sorted,
        count: sorted.length,
      },
    };
  }
);



server.registerTool(
  "lead_enrich_rncs",
  {
    title: "Enrichissement RNCS",
    description: "Ajoute les dirigeants via INPI (robuste)",
    inputSchema: {
      entreprises: z.array(z.object({
        siren: z.string(),
        nom: z.string(),
        naf: z.string(),
        departement: z.string(),
        date_creation: z.string(),
        effectif: z.string(),
        score: z.number()
      }))
    },
  },
  async ({ entreprises }) => {

    function extractDirigeant(data) {
      try {
        // 🔍 structure fréquente INPI
        const dirigeants = data?.dirigeants || data?.representants || [];

        if (Array.isArray(dirigeants) && dirigeants.length > 0) {
          const d = dirigeants[0];

          return {
            nom: d.nom || d.nom_usage || d.prenom || "Inconnu",
            fonction: d.qualite || d.role || "Dirigeant"
          };
        }

        // 🔁 fallback structures possibles
        const personnes = data?.personnes_physiques || [];

        if (personnes.length > 0) {
          const p = personnes[0];
          return {
            nom: `${p.prenom || ""} ${p.nom || ""}`.trim(),
            fonction: "Dirigeant"
          };
        }

        return {
          nom: "Non trouvé",
          fonction: "Inconnu"
        };

      } catch {
        return {
          nom: "Non trouvé",
          fonction: "Inconnu"
        };
      }
    }

    const enriched = [];

    for (const e of entreprises) {
      try {
        const url = `https://data.inpi.fr/api/companies/${e.siren}`;

        const res = await fetch(url);

        if (!res.ok) {
          throw new Error(`INPI ${res.status}`);
        }

        const data = await res.json();

        const dirigeant = extractDirigeant(data);

        enriched.push({
          ...e,
          dirigeant_nom: dirigeant.nom,
          dirigeant_fonction: dirigeant.fonction
        });

      } catch (err) {
        console.log("⚠️ INPI fallback pour", e.siren, err.message);

        enriched.push({
          ...e,
          dirigeant_nom: "Non trouvé",
          dirigeant_fonction: "Inconnu"
        });
      }
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(enriched, null, 2),
        },
      ],
      structuredContent: {
        results: enriched,
        count: enriched.length,
      },
    };
  }
);




server.registerTool(
  "lead_signals_bodacc",
  {
    title: "Signaux BODACC",
    description: "Détecte les événements récents (création, modification...)",
    inputSchema: {
      entreprises: z.array(z.object({
        siren: z.string(),
        nom: z.string(),
        naf: z.string(),
        departement: z.string(),
        date_creation: z.string(),
        effectif: z.string(),
        score: z.number(),
        dirigeant_nom: z.string().optional()
      }))
    },
  },
  async ({ entreprises }) => {

    function detectSignal(annonce) {
      const texte = JSON.stringify(annonce).toLowerCase();

      if (texte.includes("création")) return "Création récente";
      if (texte.includes("modification")) return "Modification récente";
      if (texte.includes("cession")) return "Cession";
      if (texte.includes("liquidation")) return "Procédure collective";

      return "Aucun signal";
    }

    const enriched = [];

    for (const e of entreprises) {
      try {
        const url = `https://bodacc.fr/api/data/v2/full?registre=RCS&page=1&per_page=10`;

        const res = await fetch(url);

        if (!res.ok) throw new Error("BODACC KO");

        const data = await res.json();

        const annonces = data?.annonces || [];

        // 🔍 filtrer par SIREN
        const match = annonces.find(a =>
          JSON.stringify(a).includes(e.siren)
        );

        let signal = "Aucun signal";

        if (match) {
          signal = detectSignal(match);
        }

        enriched.push({
          ...e,
          signal
        });

      } catch (err) {
        console.log("⚠️ BODACC fallback", err.message);

        enriched.push({
          ...e,
          signal: "Aucun signal"
        });
      }
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(enriched, null, 2),
        },
      ],
      structuredContent: {
        results: enriched,
        count: enriched.length,
      },
    };
  }
);






server.registerTool(
  "lead_email",
  {
    title: "Génération d'email",
    description: "Génère un email de prospection simple",
 

inputSchema: {
  entreprise: z.object({
    siren: z.string(),
    nom: z.string(),
    naf: z.string(),
    departement: z.string(),
    date_creation: z.string(),
    effectif: z.string(),
    score: z.number(),
    dirigeant_nom: z.string().optional(),
    dirigeant_fonction: z.string().optional()
  })
},

  },

  async ({ entreprise }) => {

  let angle = "optimisation technique";

  if (entreprise.effectif !== "NN") {
    const eff = parseInt(entreprise.effectif);
    if (eff >= 10 && eff <= 50) {
      angle = "structuration et performance d'équipe technique";
    }
  }

  


const introSignal =
  entreprise.signal && entreprise.signal !== "Aucun signal"
    ? `Suite à ${entreprise.signal.toLowerCase()}, `
    : "";

const message = [
  "Bonjour,",
  "",
  `${introSignal}je me permets de vous contacter car j’ai identifié ${entreprise.nom}${
    entreprise.dirigeant_nom && entreprise.dirigeant_nom !== "Non trouvé"
      ? `, dirigée par ${entreprise.dirigeant_nom}`
      : ""
  } comme une entreprise active dans le secteur ${entreprise.naf}.`,



    "",
    `Nous accompagnons des structures similaires sur des sujets de ${angle}.`,
    "",
    "Je serais ravi d’échanger avec vous pour voir si cela pourrait vous être utile.",
    "",
    "Bien à vous,"
  ].join("\n");

  return {
    content: [
      {
        type: "text",
        text: message,
      },
    ],
    structuredContent: {
      entreprise,
      message,
    },
  };
}
);




// 👉 Fonction utilitaire retry (à placer au-dessus ou en haut du fichier)
async function fetchWithRetry(url, maxRetries = 3) {
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url);

    if (response.ok) {
      return response;
    }

    const errorText = await response.text();
    lastError = new Error(
      `API recherche-entreprises a répondu ${response.status}: ${errorText}`
    );

    // 👉 si ce n’est pas un 429 → on stop direct
    if (response.status !== 429 || attempt === maxRetries) {
      throw lastError;
    }

    // 👉 backoff exponentiel + jitter
    const delayMs = 1000 * Math.pow(2, attempt) + Math.floor(Math.random() * 300);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  throw lastError;
}

// 👉 TOOL MCP
server.registerTool(
  "lead_pipeline",
  {
    title: "Pipeline complet de prospection",
    description: "Recherche, score et génère un email pour les entreprises",
    inputSchema: {
      naf: z.string(),
      departement: z.string(),
      limit: z.number().int().min(1).max(50).default(5),
    },
  },
  async ({ naf, departement, limit }) => {
    try {

      // 1. Recherche entreprises
      const nafFormatte = naf.includes(".")
        ? naf
        : `${naf.slice(0, 2)}.${naf.slice(2)}`;

      const url = `https://recherche-entreprises.api.gouv.fr/search?q=informatique&activite_principale=${encodeURIComponent(
        nafFormatte
      )}&departement=${encodeURIComponent(
        departement
      )}&etat_administratif=A&page=1&per_page=${limit}`;

     

let data;

try {
  const response = await fetchWithRetry(url, 3);
  data = await response.json();
} catch (error) {
  console.log("Fallback local activé :", error.message);

  data = {
    results: [
      {
        siren: "322095191",
        nom_complet: "ORMA INFORMATIQUE",
        activite_principale: "62.01Z",
        siege: { departement: "75" },
        date_creation: "1981-05-01",
        tranche_effectif_salarie: "12"
      },
      {
        siren: "511041337",
        nom_complet: "SIIS-GIE",
        activite_principale: "62.01Z",
        siege: { departement: "75" },
        date_creation: "2009-03-01",
        tranche_effectif_salarie: "11"
      },
      {
        siren: "479924920",
        nom_complet: "HEXAGONE INFORMATIQUE",
        activite_principale: "62.01Z",
        siege: { departement: "75" },
        date_creation: "2004-12-16",
        tranche_effectif_salarie: "NN"
      }
    ]
  };
}





      const entreprises = (data.results || [])
        .map((e) => ({
          siren: e.siren,
          nom: e.nom_complet,
          naf: e.activite_principale,
          departement: e.siege?.departement,
          date_creation: e.date_creation,
          effectif: e.tranche_effectif_salarie,
        }))
        .filter((e) => e.departement === departement)
        .slice(0, limit);

      // 2. Scoring
      

function computeScore(e) {
  let score = 0;

  // entreprise récente
  const year = parseInt(e.date_creation?.slice(0, 4));
  if (year && year >= 2015) score += 2;

  // effectif connu
  if (e.effectif !== "NN") score += 2;

  // PME intéressante
  const eff = parseInt(e.effectif);
  if (eff >= 10 && eff <= 50) score += 2;

  // secteur IT
  if (e.naf === "62.01Z") score += 2;

  // 🔥 NOUVEAU : dirigeant trouvé
  if (e.dirigeant_nom && e.dirigeant_nom !== "Non trouvé") {
    score += 2;
  }

  // 🔥 NOUVEAU : signal business
  if (e.signal && e.signal !== "Aucun signal") {
    score += 3;

    if (e.signal.toLowerCase().includes("création")) {
      score += 2; // très chaud
    }
  }

  return score;
}



      const scored = entreprises
        .map((e) => ({
          ...e,
          score: computeScore(e),
        }))
        .sort((a, b) => b.score - a.score);

      // 3. Génération email
      const results = scored.map((e) => {
        let angle = "optimisation technique";

        if (e.effectif !== "NN") {
          const eff = parseInt(e.effectif);
          if (eff >= 10 && eff <= 50) {
            angle = "structuration et performance d'équipe technique";
          }
        }

        const message = [
          "Bonjour,",
          "",
          `Je me permets de vous contacter car j’ai identifié ${e.nom} comme une entreprise active dans le secteur ${e.naf}.`,
          "",
          `Nous accompagnons des structures similaires sur des sujets de ${angle}.`,
          "",
          "Je serais ravi d’échanger avec vous pour voir si cela pourrait vous être utile.",
          "",
          "Bien à vous,"
        ].join("\n");

        return {
          ...e,
          message,
        };
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(results, null, 2),
          },
        ],
        structuredContent: {
          results,
          count: results.length,
        },
      };

    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Erreur dans lead_pipeline: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  }
);




  return server;
}

app.post("/mcp", async (req, res) => {
 res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  try {
    const sessionId = req.headers["mcp-session-id"];
    let session = sessionId ? sessions.get(sessionId) : undefined;

    // Nouvelle session => initialize obligatoire
    if (!session) {
      if (!isInitializeRequest(req.body)) {
        return res.status(400).json({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "Missing session or invalid initialize request",
          },
          id: null,
        });
      }

      const server = createServer();

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (newSessionId) => {
          sessions.set(newSessionId, { server, transport });
        },
      });

      transport.onclose = async () => {
        if (transport.sessionId) {
          sessions.delete(transport.sessionId);
        }
        try {
          await server.close();
        } catch {}
      };

      await server.connect(transport);
      session = { server, transport };
    }

    await session.transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("Erreur MCP POST :", error);
    res.status(500).json({
      jsonrpc: "2.0",
      error: {
        code: -32603,
        message: "Internal server error",
      },
      id: null,
    });
  }
});

app.get("/mcp", async (req, res) => {
 res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  const sessionId = req.headers["mcp-session-id"];
  const session = sessionId ? sessions.get(sessionId) : undefined;

  if (!session) {
    return res.status(400).send("Session MCP introuvable");
  }

  await session.transport.handleRequest(req, res);
});

app.delete("/mcp", async (req, res) => {
 res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  const sessionId = req.headers["mcp-session-id"];
  const session = sessionId ? sessions.get(sessionId) : undefined;

  if (!session) {
    return res.status(400).send("Session MCP introuvable");
  }

  await session.transport.handleRequest(req, res);
});



app.get("/", (req, res) => {
  res.send("OK");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Serveur MCP lancé sur http://localhost:${PORT}/mcp`);
});