/**
 * Persistência da cena de satélite para o anexo fotográfico do laudo.
 *
 * As três fases geram a cena com o **overlay vermelho do polígono** já desenhado
 * (`imageBuffer`) e depois jogam o buffer fora — o que sobra em `storedImageUrl`
 * é a URL crua do WMS, sem overlay e sem garantia de continuar respondendo o
 * mesmo recorte. Para o laudo isso não serve: a figura precisa ser exatamente a
 * imagem que a IA olhou.
 *
 * A Fase 1 já salvava a sua cena inline no orquestrador; este módulo é aquele
 * trecho extraído, para as Fases 2 e 3 não copiarem a mesma lógica com nomes
 * ligeiramente diferentes.
 *
 * Falha aqui é **não-fatal**: sem a figura o laudo perde o anexo, mas a análise
 * (que é o dado) continua válida.
 */

export type PersistableScene = {
  polygonId: string;
  year: number;
  usability: string;
  imageBuffer?: Buffer;
  publicImageUrl?: string;
};

/** Prefixo do arquivo por fase — mantém o storage legível ao olho humano. */
export type ScenePhasePrefix = "auas_f1" | "auas_f2" | "ac_veg";

function safeSegment(value: string): string {
  return String(value || "sem_id").replace(/[^a-zA-Z0-9_-]/g, "_");
}

/**
 * Só cena legível vira figura: `MISSING`/`INVALID` não têm o que mostrar, e
 * `BELOW_MIN_RESOLUTION` seria uma figura que o RT não consegue conferir.
 */
export function sceneWorthPersisting(usability: string): boolean {
  return usability === "USABLE" || usability === "CLOUD_OR_OCCLUSION" || usability === "LOW_RESOLUTION";
}

/**
 * Salva a cena no storage do usuário e devolve a URL pública, preenchendo
 * `scene.publicImageUrl`. Devolve `undefined` quando não há o que salvar.
 */
export async function persistSceneForReport(
  scene: PersistableScene,
  args: { uid?: string; phase: ScenePhasePrefix },
): Promise<string | undefined> {
  if (!scene.imageBuffer || !sceneWorthPersisting(scene.usability)) return undefined;
  try {
    const { saveUserBuffer } = await import("../local-storage");
    const saved = saveUserBuffer({
      uid: args.uid || "anonymous",
      area: "simcar/analysis",
      filename: `${Date.now()}_${args.phase}_${safeSegment(scene.polygonId)}_${scene.year}.png`,
      buffer: scene.imageBuffer,
    });
    scene.publicImageUrl = saved.publicUrl;
    return saved.publicUrl;
  } catch (err) {
    console.warn(`[${args.phase.toUpperCase()}] persistência da cena falhou (não-fatal):`, err);
    return undefined;
  }
}
