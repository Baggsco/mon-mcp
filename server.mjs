import express from "express";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

const app = express();
app.use(express.json({ limit: "1mb" }));

const sessions = new Map();

const DEFAULT_ESTABLISHMENT_FIELDS = [
  "siret",
  "siren",
  "nic",
  "statutDiffusionEtablissement",
  "dateCreationEtablissement",
  "trancheEffectifsEtablissement",
  "anneeEffectifsEtablissement",
  "activitePrincipaleRegistreMetiersEtablissement",
  "dateDernierTraitementEtablissement",
  "etablissementSiege",
  "etatAdministratifUniteLegale",
  "statutDiffusionUniteLegale",
  "unitePurgeeUniteLegale",
  "dateCreationUniteLegale",
  "categorieJuridiqueUniteLegale",
  "denominationUniteLegale",
  "sigleUniteLegale",
  "denominationUsuelle1UniteLegale",
  "denominationUsuelle2UniteLegale",
  "denominationUsuelle3UniteLegale",
  "sexeUniteLegale",
  "nomUniteLegale",
  "nomUsageUniteLegale",
  "prenom1UniteLegale",
  "prenom2UniteLegale",
  "prenom3UniteLegale",
  "prenom4UniteLegale",
  "prenomUsuelUniteLegale",
  "pseudonymeUniteLegale",
  "activitePrincipaleUniteLegale",
  "nomenclatureActivitePrincipaleUniteLegale",
  "identifiantAssociationUniteLegale",
  "economieSocialeSolidaireUniteLegale",
  "societeMissionUniteLegale",
  "caractereEmployeurUniteLegale",
  "trancheEffectifsUniteLegale",
  "anneeEffectifsUniteLegale",
  "nicSiegeUniteLegale",
  "dateDernierTraitementUniteLegale",
  "categorieEntreprise",
  "anneeCategorieEntreprise",
  "complementAdresseEtablissement",
  "numeroVoieEtablissement",
  "indiceRepetitionEtablissement",
  "dernierNumeroVoieEtablissement",
  "indiceRepetitionDernierNumeroVoieEtablissement",
  "typeVoieEtablissement",
  "libelleVoieEtablissement",
  "codePostalEtablissement",
  "libelleCommuneEtablissement",
  "libelleCommuneEtrangerEtablissement",
  "distributionSpecialeEtablissement",
  "codeCommuneEtablissement",
  "codeCedexEtablissement",
  "libelleCedexEtablissement",
  "codePaysEtrangerEtablissement",
  "libellePaysEtrangerEtablissement",
  "identifiantAdresseEtablissement",
  "coordonneeLambertAbscisseEtablissement",
  "coordonneeLambertOrdonneeEtablissement",
  "complementAdresse2Etablissement",
  "numeroVoie2Etablissement",
  "indiceRepetition2Etablissement",
  "typeVoie2Etablissement",
  "libelleVoie2Etablissement",
  "codePostal2Etablissement",
  "libelleCommune2Etablissement",
  "libelleCommuneEtranger2Etablissement",
  "distributionSpeciale2Etablissement",
  "codeCommune2Etablissement",
  "codeCedex2Etablissement",
  "libelleCedex2Etablissement",
  "codePaysEtranger2Etablissement",
  "libellePaysEtranger2Etablissement",
  "etatAdministratifEtablissement",
  "enseigne1Etablissement",
  "enseigne2Etablissement",
  "enseigne3Etablissement",
  "denominationUsuelleEtablissement",
  "activitePrincipaleEtablissement",
  "nomenclatureActivitePrincipaleEtablissement",
  "caractereEmployeurEtablissement",
  
];

const DEFAULT_UNITARY_FIELDS = [
  ...DEFAULT_ESTABLISHMENT_FIELDS,
  "nombrePeriodesEtablissement"
];

function uniqueStrings(values) {
  return [...new Set((values || []).filter((v) => typeof v === "string" && v.trim() !== "").map((v) => v.trim()))];
}

function toBooleanString(value, defaultValue = undefined) {
  if (value === undefined || value === null) return defaultValue;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value === "true" || value === "false") return value;
  return defaultValue;
}

function normalizeSortInput(sort) {
  if (!sort) return [];
  if (Array.isArray(sort)) {
    return sort.filter((x) => typeof x === "string" && x.trim() !== "").map((x) => x.trim());
  }
  if (typeof sort === "string" && sort.trim() !== "") {
    return [sort.trim()];
  }
  return [];
}

function normalizeFacetFieldInput(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.filter((x) => typeof x === "string" && x.trim() !== "").map((x) => x.trim());
  }
  if (typeof value === "string" && value.trim() !== "") {
    return [value.trim()];
  }
  return [];
}

function normalizeFacetIntervalsInput(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item.field === "string" && item.field.trim() !== "")
    .map((item) => ({
      field: item.field.trim(),
      min: item.min ?? undefined,
      max: item.max ?? undefined,
      label: typeof item.label === "string" && item.label.trim() !== "" ? item.label.trim() : undefined,
    }));
}

function normalizeFacetQueriesInput(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) =>
      item &&
      typeof item.name === "string" &&
      item.name.trim() !== "" &&
      typeof item.q === "string" &&
      item.q.trim() !== ""
    )
    .map((item) => ({
      name: item.name.trim(),
      q: item.q.trim(),
    }));
}

function ensureApiKey() {
  const apiKey = process.env.INSEE_API_KEY;
  if (!apiKey) {
    throw new Error("INSEE_API_KEY manquante");
  }
  return apiKey;
}

async function fetchSirene(url, { method = "GET", form = null } = {}) {
  const apiKey = ensureApiKey();

  const options = {
    method,
    headers: {
      "X-INSEE-Api-Key-Integration": apiKey,
      Accept: "application/json",
    },
  };

  if (method === "POST" && form) {
    options.headers["Content-Type"] = "application/x-www-form-urlencoded";
    options.body = form.toString();
  }

  const res = await fetch(url, options);
  const text = await res.text();

  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!res.ok) {
    const message =
      data?.header?.message ||
      data?.message ||
      text ||
      `API Sirene ${res.status}`;
    throw new Error(message);
  }

  return data;
}

function buildSearchEstablishmentsForm(args) {
  const form = new URLSearchParams();

  if (typeof args.q === "string" && args.q.trim() !== "") {
    form.set("q", args.q.trim());
  }

  if (typeof args.date === "string" && args.date.trim() !== "") {
    form.set("date", args.date.trim());
  }

  const fields = uniqueStrings(args.fields?.length ? args.fields : DEFAULT_ESTABLISHMENT_FIELDS);
  if (fields.length > 0) {
    form.set("champs", fields.join(","));
  }

  const hideNulls = toBooleanString(args.masquerValeursNulles, "false");
  if (hideNulls !== undefined) {
    form.set("masquerValeursNulles", hideNulls);
  }

  const sortItems = normalizeSortInput(args.tri);
  for (const item of sortItems) {
    form.append("tri", item);
  }

  if (Number.isInteger(args.nombre)) {
    form.set("nombre", String(args.nombre));
  }

  if (Number.isInteger(args.debut)) {
    form.set("debut", String(args.debut));
  }

  if (typeof args.curseur === "string" && args.curseur.trim() !== "") {
    form.set("curseur", args.curseur.trim());
  }

  const facetFields = normalizeFacetFieldInput(args.facetChamp);
  for (const field of facetFields) {
    form.append("facette.champ", field);
  }

  const facetQueries = normalizeFacetQueriesInput(args.facetRequetes);
  for (const fq of facetQueries) {
    form.append("facette.requete", fq.name);
    form.append(`facette.${fq.name}.q`, fq.q);
  }

  const facetIntervals = normalizeFacetIntervalsInput(args.facetIntervalles);
  for (const fi of facetIntervals) {
    form.append("facette.intervalle", fi.field);
    if (fi.min !== undefined) {
      form.append(`facette.${fi.field}.min`, String(fi.min));
    }
    if (fi.max !== undefined) {
      form.append(`facette.${fi.field}.max`, String(fi.max));
    }
    if (fi.label) {
      form.append(`facette.${fi.field}.label`, fi.label);
    }
  }

  return form;
}

function pickRequestedFields(source, requestedFields) {
  const fields = uniqueStrings(requestedFields);
  if (fields.length === 0) return source;
  const out = {};
  for (const key of fields) {
    out[key] = Object.prototype.hasOwnProperty.call(source, key) ? source[key] : null;
  }
  return out;
}

function getCurrentPeriod(periodes) {
  if (!Array.isArray(periodes) || periodes.length === 0) return null;
  const current = periodes.find((p) => p && (p.dateFin === null || p.dateFin === undefined));
  return current || periodes[0] || null;
}

function normalizeMulticriteriaEstablishment(row, requestedFields) {
  const normalized = { ...row };
  return pickRequestedFields(normalized, requestedFields);
}



function normalizeUnitaryEstablishment(payload, requestedFields) {
  const e = payload?.etablissement ?? {};
  const ul = e?.uniteLegale ?? {};
  const currentPeriod = getCurrentPeriod(e?.periodesEtablissement);



  const merged = {
    siren: e?.siren ?? null,
    nic: e?.nic ?? null,
    siret: e?.siret ?? null,

    statutDiffusionEtablissement: e?.statutDiffusionEtablissement ?? null,
    dateCreationEtablissement: e?.dateCreationEtablissement ?? null,
    trancheEffectifsEtablissement: e?.trancheEffectifsEtablissement ?? null,
    anneeEffectifsEtablissement: e?.anneeEffectifsEtablissement ?? null,
    activitePrincipaleRegistreMetiersEtablissement: e?.activitePrincipaleRegistreMetiersEtablissement ?? null,
    dateDernierTraitementEtablissement: e?.dateDernierTraitementEtablissement ?? null,
    etablissementSiege: e?.etablissementSiege ?? null,
    nombrePeriodesEtablissement: e?.nombrePeriodesEtablissement ?? null,

    etatAdministratifUniteLegale: e?.etatAdministratifUniteLegale ?? null,
    statutDiffusionUniteLegale: e?.statutDiffusionUniteLegale ?? null,
    unitePurgeeUniteLegale: e?.unitePurgeeUniteLegale ?? null,
    dateCreationUniteLegale: e?.dateCreationUniteLegale ?? null,
    categorieJuridiqueUniteLegale: e?.categorieJuridiqueUniteLegale ?? null,
    denominationUniteLegale: e?.denominationUniteLegale ?? null,
    sigleUniteLegale: e?.sigleUniteLegale ?? null,
    denominationUsuelle1UniteLegale: e?.denominationUsuelle1UniteLegale ?? null,
    denominationUsuelle2UniteLegale: e?.denominationUsuelle2UniteLegale ?? null,
    denominationUsuelle3UniteLegale: e?.denominationUsuelle3UniteLegale ?? null,
    sexeUniteLegale: e?.sexeUniteLegale ?? null,
    nomUniteLegale: e?.nomUniteLegale ?? null,
    nomUsageUniteLegale: e?.nomUsageUniteLegale ?? null,



    etatAdministratifUniteLegale:
      e?.etatAdministratifUniteLegale ??
      ul?.etatAdministratifUniteLegale ??
      null,
    statutDiffusionUniteLegale:
      e?.statutDiffusionUniteLegale ??
      ul?.statutDiffusionUniteLegale ??
      null,
    unitePurgeeUniteLegale:
      e?.unitePurgeeUniteLegale ??
      ul?.unitePurgeeUniteLegale ??
      null,
    dateCreationUniteLegale:
      e?.dateCreationUniteLegale ??
      ul?.dateCreationUniteLegale ??
      null,
    categorieJuridiqueUniteLegale:
      e?.categorieJuridiqueUniteLegale ??
      ul?.categorieJuridiqueUniteLegale ??
      null,
    denominationUniteLegale:
      e?.denominationUniteLegale ??
      ul?.denominationUniteLegale ??
      null,
    sigleUniteLegale:
      e?.sigleUniteLegale ??
      ul?.sigleUniteLegale ??
      null,
    denominationUsuelle1UniteLegale:
      e?.denominationUsuelle1UniteLegale ??
      ul?.denominationUsuelle1UniteLegale ??
      null,
    denominationUsuelle2UniteLegale:
      e?.denominationUsuelle2UniteLegale ??
      ul?.denominationUsuelle2UniteLegale ??
      null,
    denominationUsuelle3UniteLegale:
      e?.denominationUsuelle3UniteLegale ??
      ul?.denominationUsuelle3UniteLegale ??
      null,
    sexeUniteLegale:
      e?.sexeUniteLegale ??
      ul?.sexeUniteLegale ??
      null,
    nomUniteLegale:
      e?.nomUniteLegale ??
      ul?.nomUniteLegale ??
      null,
    nomUsageUniteLegale:
      e?.nomUsageUniteLegale ??
      ul?.nomUsageUniteLegale ??
      null,
    prenom1UniteLegale:
      e?.prenom1UniteLegale ??
      ul?.prenom1UniteLegale ??
      null,
    prenom2UniteLegale:
      e?.prenom2UniteLegale ??
      ul?.prenom2UniteLegale ??
      null,
    prenom3UniteLegale:
      e?.prenom3UniteLegale ??
      ul?.prenom3UniteLegale ??
      null,
    prenom4UniteLegale:
      e?.prenom4UniteLegale ??
      ul?.prenom4UniteLegale ??
      null,
    prenomUsuelUniteLegale:
      e?.prenomUsuelUniteLegale ??
      ul?.prenomUsuelUniteLegale ??
      null,
    pseudonymeUniteLegale:
      e?.pseudonymeUniteLegale ??
      ul?.pseudonymeUniteLegale ??
      null,
    activitePrincipaleUniteLegale:
      e?.activitePrincipaleUniteLegale ??
      ul?.activitePrincipaleUniteLegale ??
      null,
    nomenclatureActivitePrincipaleUniteLegale:
      e?.nomenclatureActivitePrincipaleUniteLegale ??
      e?.nomenclatureActiviteUniteLegale ??
      ul?.nomenclatureActivitePrincipaleUniteLegale ??
      ul?.nomenclatureActiviteUniteLegale ??
      null,
    identifiantAssociationUniteLegale:
      e?.identifiantAssociationUniteLegale ??
      ul?.identifiantAssociationUniteLegale ??
      null,
    economieSocialeSolidaireUniteLegale:
      e?.economieSocialeSolidaireUniteLegale ??
      ul?.economieSocialeSolidaireUniteLegale ??
      null,
    societeMissionUniteLegale:
      e?.societeMissionUniteLegale ??
      ul?.societeMissionUniteLegale ??
      null,
    caractereEmployeurUniteLegale:
      e?.caractereEmployeurUniteLegale ??
      ul?.caractereEmployeurUniteLegale ??
      null,
    trancheEffectifsUniteLegale:
      e?.trancheEffectifsUniteLegale ??
      ul?.trancheEffectifsUniteLegale ??
      null,
    anneeEffectifsUniteLegale:
      e?.anneeEffectifsUniteLegale ??
      ul?.anneeEffectifsUniteLegale ??
      null,
    nicSiegeUniteLegale:
      e?.nicSiegeUniteLegale ??
      ul?.nicSiegeUniteLegale ??
      null,
    dateDernierTraitementUniteLegale:
      e?.dateDernierTraitementUniteLegale ??
      ul?.dateDernierTraitementUniteLegale ??
      null,
    categorieEntreprise:
      e?.categorieEntreprise ??
      ul?.categorieEntreprise ??
      null,
    anneeCategorieEntreprise:
      e?.anneeCategorieEntreprise ??
      ul?.anneeCategorieEntreprise ??
      null,




    complementAdresseEtablissement: e?.adresseEtablissement?.complementAdresseEtablissement ?? null,
    numeroVoieEtablissement: e?.adresseEtablissement?.numeroVoieEtablissement ?? null,
    indiceRepetitionEtablissement: e?.adresseEtablissement?.indiceRepetitionEtablissement ?? null,
    dernierNumeroVoieEtablissement: e?.adresseEtablissement?.dernierNumeroVoieEtablissement ?? null,
    indiceRepetitionDernierNumeroVoieEtablissement:
      e?.adresseEtablissement?.indiceRepetitionDernierNumeroVoieEtablissement ?? null,
    typeVoieEtablissement: e?.adresseEtablissement?.typeVoieEtablissement ?? null,
    libelleVoieEtablissement: e?.adresseEtablissement?.libelleVoieEtablissement ?? null,
    codePostalEtablissement: e?.adresseEtablissement?.codePostalEtablissement ?? null,
    libelleCommuneEtablissement: e?.adresseEtablissement?.libelleCommuneEtablissement ?? null,
    libelleCommuneEtrangerEtablissement:
      e?.adresseEtablissement?.libelleCommuneEtrangerEtablissement ?? null,
    distributionSpecialeEtablissement:
      e?.adresseEtablissement?.distributionSpecialeEtablissement ?? null,
    codeCommuneEtablissement: e?.adresseEtablissement?.codeCommuneEtablissement ?? null,
    codeCedexEtablissement: e?.adresseEtablissement?.codeCedexEtablissement ?? null,
    libelleCedexEtablissement: e?.adresseEtablissement?.libelleCedexEtablissement ?? null,
    codePaysEtrangerEtablissement:
      e?.adresseEtablissement?.codePaysEtrangerEtablissement ?? null,
    libellePaysEtrangerEtablissement:
      e?.adresseEtablissement?.libellePaysEtrangerEtablissement ?? null,
    identifiantAdresseEtablissement:
      e?.adresseEtablissement?.identifiantAdresseEtablissement ?? null,
    coordonneeLambertAbscisseEtablissement:
      e?.adresseEtablissement?.coordonneeLambertAbscisseEtablissement ?? null,
    coordonneeLambertOrdonneeEtablissement:
      e?.adresseEtablissement?.coordonneeLambertOrdonneeEtablissement ?? null,

    complementAdresse2Etablissement: e?.adresse2Etablissement?.complementAdresse2Etablissement ?? null,
    numeroVoie2Etablissement: e?.adresse2Etablissement?.numeroVoie2Etablissement ?? null,
    indiceRepetition2Etablissement:
      e?.adresse2Etablissement?.indiceRepetition2Etablissement ?? null,
    typeVoie2Etablissement: e?.adresse2Etablissement?.typeVoie2Etablissement ?? null,
    libelleVoie2Etablissement: e?.adresse2Etablissement?.libelleVoie2Etablissement ?? null,
    codePostal2Etablissement: e?.adresse2Etablissement?.codePostal2Etablissement ?? null,
    libelleCommune2Etablissement:
      e?.adresse2Etablissement?.libelleCommune2Etablissement ?? null,
    libelleCommuneEtranger2Etablissement:
      e?.adresse2Etablissement?.libelleCommuneEtranger2Etablissement ?? null,
    distributionSpeciale2Etablissement:
      e?.adresse2Etablissement?.distributionSpeciale2Etablissement ?? null,
    codeCommune2Etablissement: e?.adresse2Etablissement?.codeCommune2Etablissement ?? null,
    codeCedex2Etablissement: e?.adresse2Etablissement?.codeCedex2Etablissement ?? null,
    libelleCedex2Etablissement: e?.adresse2Etablissement?.libelleCedex2Etablissement ?? null,
    codePaysEtranger2Etablissement:
      e?.adresse2Etablissement?.codePaysEtranger2Etablissement ?? null,
    libellePaysEtranger2Etablissement:
      e?.adresse2Etablissement?.libellePaysEtranger2Etablissement ?? null,

    etatAdministratifEtablissement:
      currentPeriod?.etatAdministratifEtablissement ?? null,
    enseigne1Etablissement: currentPeriod?.enseigne1Etablissement ?? null,
    enseigne2Etablissement: currentPeriod?.enseigne2Etablissement ?? null,
    enseigne3Etablissement: currentPeriod?.enseigne3Etablissement ?? null,
    denominationUsuelleEtablissement:
      currentPeriod?.denominationUsuelleEtablissement ?? null,
    activitePrincipaleEtablissement:
      currentPeriod?.activitePrincipaleEtablissement ?? null,
    nomenclatureActivitePrincipaleEtablissement:
      currentPeriod?.nomenclatureActivitePrincipaleEtablissement ?? null,
    caractereEmployeurEtablissement:
      currentPeriod?.caractereEmployeurEtablissement ?? null,

















  };

  return pickRequestedFields(merged, requestedFields);
}

const searchInputSchema = {
  q: z.string().optional().describe("Requête multicritère Sirene brute. Exemple: codeCommuneEtablissement:49127 AND periode(etatAdministratifEtablissement:A)"),
  date: z.string().optional().describe("Date de situation AAAA-MM-JJ"),
  fields: z.array(z.string()).optional().describe("Liste de champs à retourner. Si absent, une liste par défaut complète est utilisée."),
  masquerValeursNulles: z.boolean().optional().describe("Si true, demande à Sirene de masquer les valeurs nulles."),
  tri: z.union([z.string(), z.array(z.string())]).optional().describe("Champ(s) de tri Sirene"),
  nombre: z.number().int().min(0).max(100).default(10).describe("Nombre de résultats à retourner"),
  debut: z.number().int().min(0).optional().describe("Offset de pagination"),
  curseur: z.string().optional().describe("Curseur de pagination Sirene"),
  facetChamp: z.union([z.string(), z.array(z.string())]).optional().describe("Champ(s) de facette automatiques"),
  facetRequetes: z.array(z.object({
    name: z.string(),
    q: z.string(),
  })).optional().describe("Facettes personnalisées de type requête"),
  facetIntervalles: z.array(z.object({
    field: z.string(),
    min: z.union([z.number(), z.string()]).optional(),
    max: z.union([z.number(), z.string()]).optional(),
    label: z.string().optional(),
  })).optional().describe("Facettes par intervalles"),
};



async function hydrateEstablishments(sirets, requestedFields) {
  const results = [];

  for (const siret of sirets) {
    try {
      const url = `https://api.insee.fr/api-sirene/3.11/siret/${siret}`;
      const data = await fetchSirene(url, { method: "GET" });

      const normalized = normalizeUnitaryEstablishment(
        data,
        requestedFields
      );

      results.push(normalized);
    } catch (error) {
      results.push({
        siret,
        error: true,
        message:
          error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}










function createServer() {
  const server = new McpServer({
    name: "sirene-siret-agent",
    version: "2.0.0",
  });

  server.registerTool(
    "search_establishments",
    {
      title: "Recherche multicritère d'établissements SIRENE",
      description:
        "Recherche multicritère sur /siret. Le filtrage passe par q. Les champs retournés sont configurables via fields. Les résultats sont SIRET-first.",
      inputSchema: searchInputSchema,
    },
    async (args) => {
      try {
        const form = buildSearchEstablishmentsForm(args);
        const data = await fetchSirene("https://api.insee.fr/api-sirene/3.11/siret", {
          method: "POST",
          form,
        });

        const requestedFields = uniqueStrings(args.fields?.length ? args.fields : DEFAULT_ESTABLISHMENT_FIELDS);
        const results = Array.isArray(data?.etablissements)
          ? data.etablissements.map((row) => normalizeMulticriteriaEstablishment(row, requestedFields))
          : [];

        const payload = {
          header: data?.header ?? null,
          query: {
            q: args.q ?? null,
            date: args.date ?? null,
            nombre: args.nombre ?? 10,
            debut: args.debut ?? null,
            curseur: args.curseur ?? null,
            tri: normalizeSortInput(args.tri),
            fields: requestedFields,
            masquerValeursNulles: args.masquerValeursNulles ?? false,
            facetChamp: normalizeFacetFieldInput(args.facetChamp),
            facetRequetes: normalizeFacetQueriesInput(args.facetRequetes),
            facetIntervalles: normalizeFacetIntervalsInput(args.facetIntervalles),
          },
          results,
          facettes: data?.facettes ?? null,
          nextCursor: data?.header?.curseur ?? null,
        };

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(payload, null, 2),
            },
          ],
          structuredContent: payload,
        };
      } catch (error) {
        const payload = {
          error: true,
          message: error instanceof Error ? error.message : String(error),
        };

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(payload, null, 2),
            },
          ],
          isError: true,
          structuredContent: payload,
        };
      }
    }
  );





server.registerTool(
  "search_and_hydrate_establishments",
  {
    title: "Recherche + hydratation complète SIRENE",
    description:
      "Recherche multicritère puis hydratation complète des établissements via SIRET.",
    








inputSchema: {
  q: z.string(),
  nombre: z.number().int().min(1).max(20).default(5),
  fields: z.array(z.string()).optional(),
  actifsSeulement: z.boolean().default(true),
},









  },
  async (args) => {
    try {



      // 1. Recherche
     


const qFinal =
  args.actifsSeulement === false
    ? args.q
    : args.q.includes("etatAdministratifEtablissement")
      ? args.q
      : `${args.q} AND periode(etatAdministratifEtablissement:A)`;






const nombreFinal = args.nombre;
const nombreRecherche = Math.min(nombreFinal * 10, 100);

const form = buildSearchEstablishmentsForm({
  q: qFinal,
  nombre: nombreRecherche,
});




      const searchData = await fetchSirene(
        "https://api.insee.fr/api-sirene/3.11/siret",
        {
          method: "POST",
          form,
        }
      );

      const sirets =
        searchData?.etablissements?.map((e) => e.siret) || [];

      // 2. Hydratation
      const requestedFields = uniqueStrings(
        args.fields?.length
          ? args.fields
          : DEFAULT_UNITARY_FIELDS
      );

      const hydrated = await hydrateEstablishments(
        sirets,
        requestedFields
      );






const filtered =
  args.actifsSeulement === false
    ? hydrated
    : hydrated.filter(
        (e) => e.etatAdministratifEtablissement === "A"
      );

const finalResults = filtered.slice(0, nombreFinal);

const payload = {
  query: args.q,
  queryExecutee: qFinal,
  actifsSeulement: args.actifsSeulement !== false,
  total: searchData?.header?.total ?? null,
  nombreDemande: nombreFinal,
  nombreRecherche,
  count: finalResults.length,
  results: finalResults,
};





      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(payload, null, 2),
          },
        ],
        structuredContent: payload,
      };
    } catch (error) {
      const payload = {
        error: true,
        message:
          error instanceof Error ? error.message : String(error),
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(payload, null, 2),
          },
        ],
        isError: true,
        structuredContent: payload,
      };
    }
  }
);
















  server.registerTool(
    "get_establishment_by_siret",
    {
      title: "Fiche établissement par SIRET",
      description:
        "Lit la fiche détaillée d'un établissement via /siret/{siret}. Retourne les valeurs courantes unité légale, adresse, et la période courante des variables historisées établissement.",
      inputSchema: {
        siret: z.string().regex(/^\d{14}$/).describe("SIRET à 14 chiffres"),
        date: z.string().optional().describe("Date de situation AAAA-MM-JJ"),
        fields: z.array(z.string()).optional().describe("Champs à retourner. Si absent, liste complète par défaut."),
        masquerValeursNulles: z.boolean().optional(),
      },
    },
    async (args) => {
      try {
        const params = new URLSearchParams();
        if (typeof args.date === "string" && args.date.trim() !== "") {
          params.set("date", args.date.trim());
        }

        const requestedFields = uniqueStrings(args.fields?.length ? args.fields : DEFAULT_UNITARY_FIELDS);
        if (requestedFields.length > 0) {
          params.set("champs", requestedFields.join(","));
        }

        const hideNulls = toBooleanString(args.masquerValeursNulles, "false");
        if (hideNulls !== undefined) {
          params.set("masquerValeursNulles", hideNulls);
        }

        const url =
          params.toString().length > 0
            ? `https://api.insee.fr/api-sirene/3.11/siret/${args.siret}?${params.toString()}`
            : `https://api.insee.fr/api-sirene/3.11/siret/${args.siret}`;

        const data = await fetchSirene(url, { method: "GET" });
        const result = normalizeUnitaryEstablishment(data, requestedFields);





               const payload = {
          header: data?.header ?? null,
          siret: args.siret,
          date: args.date && args.date.trim() !== "" ? args.date.trim() : null,
          result,
        };





        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(payload, null, 2),
            },
          ],
          structuredContent: payload,
        };
      } catch (error) {
        const payload = {
          error: true,
          message: error instanceof Error ? error.message : String(error),
        };

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(payload, null, 2),
            },
          ],
          isError: true,
          structuredContent: payload,
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

app.get("/", (_req, res) => {
  res.send("OK");
});

const PORT = Number(process.env.PORT || 3000);

app
  .listen(PORT, () => {
    console.log(`✅ MCP server running on http://localhost:${PORT}/mcp`);
  })
  .on("error", (err) => {
    console.error("❌ Erreur serveur :", err);
  });