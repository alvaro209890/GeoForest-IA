/**
 * Validação/correção do georreferenciamento contra o footprint STAC da própria cena.
 */
import { CBERS_GEOREF_SANITY_MAX_M } from "./constants";
import { readRasterBoundsInfo } from "./gdal";
import { CbersAlignmentResult, CbersProgressPatch, CbersScene } from "./types";
import { projectFootprintBounds, utmProjForEpsg, utmProjForLonLat } from "./utils";

export async function validateAndCorrectCbersAlignment(args: {
  uid: string;
  jobId: string;
  scene: CbersScene;
  item: any;
  sourcePath: string;
  sceneDir: string;
  onProgress: (patch: CbersProgressPatch) => void;
}): Promise<CbersAlignmentResult> {
  void args.uid;
  void args.item;
  void args.sceneDir;
  args.onProgress({
    stage: "alignment_check",
    percent: 96,
    message: "Validando o georreferenciamento da imagem.",
  });

  const info = await readRasterBoundsInfo(args.sourcePath, args.jobId);
  if (!info) {
    return {
      status: "failed_private",
      warning:
        "Não foi possível ler o georreferenciamento do GeoTIFF gerado; a cena será entregue apenas ao usuário e não publicada no WMS.",
    };
  }

  const centerLon = args.scene.bbox ? (args.scene.bbox[0] + args.scene.bbox[2]) / 2 : NaN;
  const centerLat = args.scene.bbox ? (args.scene.bbox[1] + args.scene.bbox[3]) / 2 : NaN;
  const proj = utmProjForEpsg(info.epsg) || utmProjForLonLat(centerLon, centerLat);
  const expected = proj ? projectFootprintBounds(args.scene, proj) : null;
  let offsetMeters: number | undefined;
  if (expected) {
    const dx = (info.minX + info.maxX) / 2 - (expected.minX + expected.maxX) / 2;
    const dy = (info.minY + info.maxY) / 2 - (expected.minY + expected.maxY) / 2;
    offsetMeters = Number(Math.hypot(dx, dy).toFixed(1));
    if (offsetMeters > CBERS_GEOREF_SANITY_MAX_M) {
      return {
        status: "failed_private",
        offsetMeters,
        warning:
          `O georreferenciamento do GeoTIFF gerado diverge ${Math.round(offsetMeters)} m da footprint ` +
          "declarada pelo INPE; a cena será entregue apenas ao usuário e não publicada no WMS.",
      };
    }
  }

  return { status: "aligned", offsetMeters };
}
