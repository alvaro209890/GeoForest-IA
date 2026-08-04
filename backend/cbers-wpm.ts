/**
 * CBERS-4A WPM — pipeline de geração e publicação de imagens.
 *
 * Busca STAC (BDC/INPE) → download das bandas → pansharpening → realce para
 * 8 bits → validação do georreferenciamento → publicação no GeoServer, com
 * reaproveitamento do acervo local e entrega em ZIP.
 *
 * Endpoints: /api/cbers/*  (ver `backend/cbers/routes.ts`)
 *
 * NOTA (Plano 05, 03/08/2026): o monólito de 2.693 linhas foi desmembrado em
 * `backend/cbers/`. Este arquivo é apenas o barrel público — a API exportada
 * continua idêntica.
 */
export * from "./cbers/index";
