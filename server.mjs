import express from "express";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

const app = express();
app.use(express.json());

const sessions = new Map();




const SIRENE_FIELDS = [
  "siret",
  "siren",
  "nic",
  "statutDiffusionEtablissement",
  "dateCreationEtablissement",
  "trancheEffectifsEtablissement",
  "activitePrincipaleEtablissement",
  "etatAdministratifEtablissement",
  "denominationUniteLegale",
  "codeCommuneEtablissement",
  "libelleCommuneEtablissement",
  "codePostalEtablissement",
  "libelleVoieEtablissement",
  "numeroVoieEtablissement"
];






function mapRaw(e) {
  return {
    siren: e?.siren ?? null,
    nic: e?.nic ?? null,
    siret: e?.siret ?? null,
    statutDiffusionEtablissement: e?.statutDiffusionEtablissement ?? null,
    dateCreationEtablissement: e?.dateCreationEtablissement ?? null,
    trancheEffectifsEtablissement: e?.trancheEffectifsEtablissement ?? null,
    activitePrincipaleRegistreMetiersEtablissement: e?.activitePrincipaleRegistreMetiersEtablissement ?? null,
    etatAdministratifUniteLegale: e?.etatAdministratifUniteLegale ?? null,
    denominationUniteLegale: e?.denominationUniteLegale ?? null,
    codeCommuneEtablissement: e?.codeCommuneEtablissement ?? null,
    libelleCommuneEtablissement: e?.libelleCommuneEtablissement ?? null,
    codePostalEtablissement: e?.codePostalEtablissement ?? null,
   
  };
}










function createServer() {
  const server = new McpServer({
    name: "sirene-siret-server",
    version: "1.0.0",
  });

  server.registerTool(
    "search_establishments",
    {
      description: "Retourne des établissements SIRET réels depuis l'API INSEE Sirene",
      inputSchema: {
        q: z.string(),
        limit: z.number().int().min(1).max(100).default(10),
      },
    },
    async ({ q, limit }) => {
      const apiKey = process.env.INSEE_API_KEY;
      if (!apiKey) throw new Error("INSEE_API_KEY manquante");

      

const form = new URLSearchParams();
form.set("q", q);
form.set("nombre", String(limit));
form.set("champs", SIRENE_FIELDS.join(","));
form.set("masquerValeursNulles", "false");

const res = await fetch("https://api.insee.fr/api-sirene/3.11/siret", {
  method: "POST",
  headers: {
    "X-INSEE-Api-Key-Integration": apiKey,
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  },
  body: form.toString(),
});





      if (!res.ok) {
        throw new Error(await res.text());
      }

      const data = await res.json();
      const results = (data.etablissements || []).map(mapRaw);

      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
      };
    }
  );

  return server;
}

app.post("/mcp", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");

  try {
    const sessionId = req.headers["mcp-session-id"];
    let session = sessionId ? sessions.get(sessionId) : undefined;

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

const PORT = 3000;

app.listen(PORT, () => {
  console.log(`✅ MCP server running on http://localhost:${PORT}/mcp`);
}).on("error", (err) => {
  console.error("❌ Erreur serveur :", err);
});