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
      description: "Retourne une recherche simulée d'entreprises par code NAF et département.",
      inputSchema: {
        naf: z.string().describe("Code NAF, ex: 6201Z"),
        departement: z.string().describe("Code département, ex: 75"),
        limit: z.number().int().min(1).max(100).default(10),
      },
    },
   async ({ naf, departement, limit }) => {
  try {
    const nafFormatte = naf.includes(".") ? naf : `${naf.slice(0, 2)}.${naf.slice(2)}`;
const url = `https://recherche-entreprises.api.gouv.fr/search?q=informatique&activite_principale=${encodeURIComponent(nafFormatte)}&departement=${encodeURIComponent(departement)}&etat_administratif=A&page=1&per_page=${limit}`;

    const response = await fetch(url);
    const data = await response.json();

    const results = (data.results || [])
  .map((entreprise) => ({
    siren: entreprise.siren,
    nom: entreprise.nom_complet,
    naf: entreprise.activite_principale,
    departement: entreprise.siege?.departement,
    date_creation: entreprise.date_creation,
    effectif: entreprise.tranche_effectif_salarie,
  }))
  .filter((entreprise) => entreprise.departement === departement)
  .slice(0, limit);

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
          text: "Erreur lors de l'appel API SIRENE",
        },
      ],
    };
  }
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
        score: z.number()
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

  const message = [
    "Bonjour,",
    "",
    `Je me permets de vous contacter car j’ai identifié ${entreprise.nom} comme une entreprise active dans le secteur ${entreprise.naf}.`,
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

        const year = parseInt(e.date_creation?.slice(0, 4));
        if (year && year >= 2015) score += 2;

        if (e.effectif !== "NN") score += 2;

        const eff = parseInt(e.effectif);
        if (eff >= 10 && eff <= 50) score += 2;

        if (e.naf === "62.01Z") score += 2;

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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Serveur MCP lancé sur http://localhost:${PORT}/mcp`);
});