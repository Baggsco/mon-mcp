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
  "siren","nic","siret",
  "statutDiffusionEtablissement","dateCreationEtablissement","trancheEffectifsEtablissement",
  "anneeEffectifsEtablissement","activitePrincipaleRegistreMetiersEtablissement",
  "dateDernierTraitementEtablissement","etablissementSiege",
  "uniteLegale.etatAdministratifUniteLegale",
  "uniteLegale.statutDiffusionUniteLegale",
  "uniteLegale.unitePurgeeUniteLegale",
  "uniteLegale.dateCreationUniteLegale",
  "uniteLegale.categorieJuridiqueUniteLegale",
  "uniteLegale.denominationUniteLegale",
  "uniteLegale.sigleUniteLegale",
  "uniteLegale.denominationUsuelle1UniteLegale",
  "uniteLegale.denominationUsuelle2UniteLegale",
  "uniteLegale.denominationUsuelle3UniteLegale",
  "uniteLegale.sexeUniteLegale",
  "uniteLegale.nomUniteLegale",
  "uniteLegale.nomUsageUniteLegale",
  "uniteLegale.prenom1UniteLegale",
  "uniteLegale.prenom2UniteLegale",
  "uniteLegale.prenom3UniteLegale",
  "uniteLegale.prenom4UniteLegale",
  "uniteLegale.prenomUsuelUniteLegale",
  "uniteLegale.pseudonymeUniteLegale",
  "uniteLegale.activitePrincipaleUniteLegale",
  "uniteLegale.nomenclatureActivitePrincipaleUniteLegale",
  "uniteLegale.identifiantAssociationUniteLegale",
  "uniteLegale.economieSocialeSolidaireUniteLegale",
  "uniteLegale.societeMissionUniteLegale",
  "uniteLegale.caractereEmployeurUniteLegale",
  "uniteLegale.trancheEffectifsUniteLegale",
  "uniteLegale.anneeEffectifsUniteLegale",
  "uniteLegale.nicSiegeUniteLegale",
  "uniteLegale.dateDernierTraitementUniteLegale",
  "uniteLegale.categorieEntreprise",
  "uniteLegale.anneeCategorieEntreprise",
  "adresseEtablissement.complementAdresseEtablissement",
  "adresseEtablissement.numeroVoieEtablissement",
  "adresseEtablissement.indiceRepetitionEtablissement",
  "adresseEtablissement.dernierNumeroVoieEtablissement",
  "adresseEtablissement.indiceRepetitionDernierNumeroVoieEtablissement",
  "adresseEtablissement.typeVoieEtablissement",
  "adresseEtablissement.libelleVoieEtablissement",
  "adresseEtablissement.codePostalEtablissement",
  "adresseEtablissement.libelleCommuneEtablissement",
  "adresseEtablissement.libelleCommuneEtrangerEtablissement",
  "adresseEtablissement.distributionSpecialeEtablissement",
  "adresseEtablissement.codeCommuneEtablissement",
  "adresseEtablissement.codeCedexEtablissement",
  "adresseEtablissement.libelleCedexEtablissement",
  "adresseEtablissement.codePaysEtrangerEtablissement",
  "adresseEtablissement.libellePaysEtrangerEtablissement",
  "adresseEtablissement.identifiantAdresseEtablissement",
  "adresseEtablissement.coordonneeLambertAbscisseEtablissement",
  "adresseEtablissement.coordonneeLambertOrdonneeEtablissement",
  "adresse2Etablissement.complementAdresse2Etablissement",
  "adresse2Etablissement.numeroVoie2Etablissement",
  "adresse2Etablissement.indiceRepetition2Etablissement",
  "adresse2Etablissement.typeVoie2Etablissement",
  "adresse2Etablissement.libelleVoie2Etablissement",
  "adresse2Etablissement.codePostal2Etablissement",
  "adresse2Etablissement.libelleCommune2Etablissement",
  "adresse2Etablissement.libelleCommuneEtranger2Etablissement",
  "adresse2Etablissement.distributionSpeciale2Etablissement",
  "adresse2Etablissement.codeCommune2Etablissement",
  "adresse2Etablissement.codeCedex2Etablissement",
  "adresse2Etablissement.libelleCedex2Etablissement",
  "adresse2Etablissement.codePaysEtranger2Etablissement",
  "adresse2Etablissement.libellePaysEtranger2Etablissement",
  "etatAdministratifEtablissement",
  "enseigne1Etablissement",
  "enseigne2Etablissement",
  "enseigne3Etablissement",
  "denominationUsuelleEtablissement",
  "activitePrincipaleEtablissement",
  "nomenclatureActivitePrincipaleEtablissement",
  "caractereEmployeurEtablissement"
];

function mapRaw(e) {
  return {
    siren: e?.siren ?? null,
    nic: e?.nic ?? null,
    siret: e?.siret ?? null,

    ...e?.uniteLegale,
    ...e?.adresseEtablissement,
    ...e?.adresse2Etablissement,

    statutDiffusionEtablissement: e?.statutDiffusionEtablissement ?? null,
    dateCreationEtablissement: e?.dateCreationEtablissement ?? null,
    trancheEffectifsEtablissement: e?.trancheEffectifsEtablissement ?? null,
    anneeEffectifsEtablissement: e?.anneeEffectifsEtablissement ?? null,
    activitePrincipaleRegistreMetiersEtablissement: e?.activitePrincipaleRegistreMetiersEtablissement ?? null,
    dateDernierTraitementEtablissement: e?.dateDernierTraitementEtablissement ?? null,
    etablissementSiege: e?.etablissementSiege ?? null,
    etatAdministratifEtablissement: e?.etatAdministratifEtablissement ?? null,
    enseigne1Etablissement: e?.enseigne1Etablissement ?? null,
    enseigne2Etablissement: e?.enseigne2Etablissement ?? null,
    enseigne3Etablissement: e?.enseigne3Etablissement ?? null,
    denominationUsuelleEtablissement: e?.denominationUsuelleEtablissement ?? null,
    activitePrincipaleEtablissement: e?.activitePrincipaleEtablissement ?? null,
    nomenclatureActivitePrincipaleEtablissement: e?.nomenclatureActivitePrincipaleEtablissement ?? null,
    caractereEmployeurEtablissement: e?.caractereEmployeurEtablissement ?? null,
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

      const url = new URL("https://api.insee.fr/api-sirene/3.11/siret");
      url.searchParams.set("q", q);
      url.searchParams.set("nombre", String(limit));
      url.searchParams.set("champs", SIRENE_FIELDS.join(","));

      const res = await fetch(url, {
        headers: {
          "X-INSEE-Api-Key-Integration": apiKey,
          Accept: "application/json",
        },
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