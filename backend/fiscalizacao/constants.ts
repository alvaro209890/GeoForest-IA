/**
 * Endpoints e catálogo de camadas da análise de fiscalização.
 */
import type { FiscalizacaoKind, FiscalizacaoSource } from "./types";

/** ArcGIS Server do IBAMA (PAMGIA). O REST devolve geometria + atributos. */
export const PAMGIA_EMBARGOS_URL =
  process.env.PAMGIA_EMBARGOS_URL ||
  "https://pamgia.ibama.gov.br/server/rest/services/01_Publicacoes_Bases/adm_embargos_ibama_a/MapServer/0/query";

/** GeoServer da IMAP — mesmas camadas que o ArcMap consome pelo WMS. */
export const IMAP_WFS_BASE =
  process.env.IMAP_WFS_BASE || "https://wms.cursar.space/geoserver/cbers/wfs";

/** O PAMGIA recusa requisições sem User-Agent de navegador (HTTP 403). */
export const HTTP_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) GeoForest-IA/1.0";

export const REQUEST_TIMEOUT_MS = 90_000;

/** Folga ao redor da ATP na busca — pega também os confrontantes. */
export const DEFAULT_BUFFER_METERS = 2000;

export const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Máximo de feições por camada, para não estourar a memória num bbox grande. */
export const MAX_FEATURES_PER_LAYER = 500;

export type ImapLayerDef = {
  /** Nome da camada no workspace `cbers`. */
  name: string;
  label: string;
  kind: FiscalizacaoKind;
  source: Extract<FiscalizacaoSource, "sema" | "siga">;
  /** Campos de onde sai nome / CPF / data em cada esquema. */
  fieldNome: string[];
  fieldCpf: string[];
  fieldData: string[];
  fieldDoc: string[];
  fieldProcesso: string[];
  fieldMunicipio: string[];
  fieldImovel: string[];
  fieldDescricao: string[];
  fieldSituacao: string[];
  fieldArea: string[];
};

const SEMA_FIELDS = {
  fieldNome: ["NOME"],
  fieldCpf: ["CPF_CNPJ"],
  fieldData: ["DAT_LAVRAT", "ANO_DESMAT"],
  fieldDoc: ["T_EMBARGO", "A_INFRAC", "NUMERO"],
  fieldProcesso: ["N_PROCESSO", "PROCESSO"],
  fieldMunicipio: ["MUNICIPIO"],
  fieldImovel: ["PROPRIEDAD"],
  fieldDescricao: ["DANO", "OBS", "SUBTIPO"],
  fieldSituacao: ["SITUACAO"],
  fieldArea: ["AREA_HA", "AREA_DESMA"],
};

const SIGA_FIELDS = {
  fieldNome: ["NOME_RAZAO"],
  fieldCpf: ["CPFCNPJ"],
  fieldData: ["DATA_DO_AU", "DATA_ENVIO"],
  fieldDoc: ["NUMERO_AUT", "NUMERO_TER"],
  fieldProcesso: ["NUMERO_PRO"],
  fieldMunicipio: ["MUNICIPIO_"],
  fieldImovel: ["NOME_FANTA"],
  fieldDescricao: ["DESCRICAO_", "SUBTIPO", "TIPO"],
  fieldSituacao: ["SITUACAO"],
  fieldArea: ["QUANTIDADE"],
};

export const IMAP_LAYERS: ImapLayerDef[] = [
  {
    name: "fiscalizacao_areas_embargadas_sema",
    label: "Áreas Embargadas — SEMA",
    kind: "embargo",
    source: "sema",
    ...SEMA_FIELDS,
  },
  {
    name: "fiscalizacao_areas_desembargadas_sema",
    label: "Áreas Desembargadas — SEMA",
    kind: "desembargo",
    source: "sema",
    ...SEMA_FIELDS,
  },
  {
    name: "fiscalizacao_autos_de_infracao",
    label: "Autos de Infração — SEMA",
    kind: "auto",
    source: "sema",
    ...SEMA_FIELDS,
    fieldData: ["DATA_EMISS"],
    fieldDoc: ["NUMERO"],
    fieldProcesso: ["PROCESSO"],
    fieldImovel: ["RAZAO_SOCI"],
    fieldArea: ["AREA_DESMA"],
  },
  {
    name: "fiscalizacao_area_embargada_siga_poligono",
    label: "Área Embargada — SIGA (polígono)",
    kind: "embargo",
    source: "siga",
    ...SIGA_FIELDS,
  },
  {
    name: "fiscalizacao_area_embargada_siga_ponto",
    label: "Área Embargada — SIGA (ponto)",
    kind: "embargo",
    source: "siga",
    ...SIGA_FIELDS,
  },
  {
    name: "fiscalizacao_areas_desembargadas_siga_poligono",
    label: "Área Desembargada — SIGA",
    kind: "desembargo",
    source: "siga",
    ...SIGA_FIELDS,
  },
  {
    name: "fiscalizacao_autos_de_infracao_siga_poligono",
    label: "Auto de Infração — SIGA (polígono)",
    kind: "auto",
    source: "siga",
    ...SIGA_FIELDS,
  },
  {
    name: "fiscalizacao_autos_de_infracao_siga_ponto",
    label: "Auto de Infração — SIGA (ponto)",
    kind: "auto",
    source: "siga",
    ...SIGA_FIELDS,
  },
];

export const SOURCE_LABELS: Record<FiscalizacaoSource, string> = {
  ibama: "IBAMA — Embargos (PAMGIA)",
  sema: "SEMA-MT — Fiscalização",
  siga: "SIGA — Fiscalização",
};

/** Cor por natureza do ato. Nenhuma colide com o traço da ATP (amarelo). */
export const KIND_COLORS: Record<FiscalizacaoKind, string> = {
  embargo: "#d32f2f",
  auto: "#7b1fa2",
  desembargo: "#00838f",
};

export const KIND_LABELS: Record<FiscalizacaoKind, string> = {
  embargo: "Embargo",
  auto: "Auto de infração",
  desembargo: "Desembargo",
};

/** Traço da ATP no mapa — amarelo, reservado só para o imóvel. */
export const ATP_COLOR = "#ffd21f";
