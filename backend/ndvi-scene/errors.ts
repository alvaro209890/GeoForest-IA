/**
 * Erros do pipeline NDVI de cena completa.
 *
 * Segue a regra da casa (ver `backend/ndvi/types.ts`): quando não dá para medir,
 * o job **declara** o motivo — nunca estima.
 */

/** Motivos de falha traduzíveis para o estado do job. */
export type NdviSceneFailureCode =
  | "bandas_insuficientes"
  | "cena_nao_encontrada"
  | "sem_cena"
  | "falha_materializacao";

export const NDVI_SCENE_FAILURE_MESSAGES: Record<NdviSceneFailureCode, string> = {
  bandas_insuficientes:
    "A cena não trouxe todas as bandas necessárias (nir08, red, green, blue, swir16, qa_pixel).",
  cena_nao_encontrada: "A cena solicitada não foi encontrada no STAC do Planetary Computer.",
  sem_cena: "Não há cena Landsat C2 L2 disponível para o período/área solicitados.",
  falha_materializacao: "Falha ao materializar a cena completa a partir do Planetary Computer.",
};

/** Erro que o job sabe traduzir para o estado final. */
export class NdviSceneFailure extends Error {
  code: NdviSceneFailureCode;
  constructor(code: NdviSceneFailureCode, message?: string) {
    super(message || NDVI_SCENE_FAILURE_MESSAGES[code]);
    this.name = "NdviSceneFailure";
    this.code = code;
  }
}
