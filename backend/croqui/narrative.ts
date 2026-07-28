import { formatDistance } from "./coords";
import type { CroquiLandmark } from "./landmarks";
import type { CroquiRoute, RouteWaypoint } from "./routing";

const QUERENCIA_IBGE = "5107909";

function roadLabel(road: string): string {
  const r = String(road || "").trim();
  if (!r || r === "-") return "estrada";
  return r;
}

function stepPhrase(
  step: RouteWaypoint,
  stepIndex: number,
  propertyName: string,
  atpInQuerencia: boolean,
  isLast: boolean,
): string {
  const dist = formatDistance(step.distanceFromPrevM);
  const road = roadLabel(step.roadName);
  const dms = step.dms;
  const ins = step.instruction.toLowerCase();

  if (isLast && (step.instruction.includes("Chegada") || ins.includes("destino"))) {
    return `Onde se encontra a sede da propriedade.`;
  }

  if (stepIndex === 0) {
    if (atpInQuerencia) {
      return `Siga sentido ao ${propertyName.trim()} pela ${road} por ${dist} até o ponto ${dms}.`;
    }
    return `Siga em frente pela ${road} por ${dist} até o ponto ${dms}.`;
  }

  if (ins.includes("entroncamento")) {
    if (ins.includes("direita")) {
      return `Ao chegar no entroncamento, vire à direita pela ${road} e siga em frente por ${dist} até o ponto ${dms}.`;
    }
    return `Chegando ao entroncamento, siga em frente pela ${road} por ${dist} até o ponto ${dms}.`;
  }
  if (ins.includes("bifurcação") || ins.includes("bifurcacao") || ins.includes("fork")) {
    return `Ao chegar na bifurcação, siga em frente por ${dist} até o ponto ${dms}.`;
  }
  if (ins.includes("cruzamento")) {
    return `Ao chegar no cruzamento, vire à esquerda e siga em frente por ${dist} até o ponto ${dms}.`;
  }
  if (ins.includes("esquerda")) {
    return `Vire à esquerda e siga em frente por ${dist} até o ponto ${dms}.`;
  }
  if (ins.includes("direita")) {
    return `Vire à direita e siga em frente por ${dist} até o ponto ${dms}.`;
  }
  if (ins.includes("rotatória") || ins.includes("rotatoria")) {
    return `Na rotatória, siga pela ${road} por ${dist} até o ponto ${dms}.`;
  }
  return `Siga em frente pela ${road} por ${dist} até o ponto ${dms}.`;
}

export function buildCroquiNarrative(args: {
  municipioNome: string;
  municipioIbge?: string | null;
  propertyName: string;
  landmark: CroquiLandmark;
  route: CroquiRoute;
  startDms: string;
}): string {
  const { municipioNome, propertyName, landmark, route, startDms } = args;
  const municipioIbge = args.municipioIbge || null;
  const atpInQuerencia = municipioIbge === QUERENCIA_IBGE;
  const mun = municipioNome.trim() || "MT";

  let intro: string;
  if (atpInQuerencia) {
    const suffix =
      landmark.introSuffix ||
      (landmark.label ? `na ${landmark.label}` : "em ponto de referência municipal");
    intro = `Inicia-se o croqui no município de ${mun} – MT ${suffix}, no ponto ${startDms}.`;
  } else if (
    landmark.label.includes("Av. Norte") ||
    landmark.introSuffix?.includes("Av. Norte")
  ) {
    intro = `Inicia-se o croqui na rotatória da MT-109 com a Av. Norte, no ponto ${startDms}.`;
  } else {
    const suffix = landmark.introSuffix || landmark.label;
    intro = `Inicia-se o croqui ${suffix}, no ponto ${startDms}.`;
  }

  const parts: string[] = [intro];
  const driving = route.waypoints.filter((w) => w.distanceFromPrevM > 0);

  for (let i = 0; i < driving.length; i++) {
    parts.push(
      stepPhrase(driving[i], i, propertyName, atpInQuerencia, i === driving.length - 1),
    );
  }

  const joined = parts.join(" ");
  if (!joined.includes("sede da propriedade")) {
    parts.push("Onde se encontra a sede da propriedade.");
  }

  return parts.join(" ");
}

/** Parágrafos para DOCX no estilo dos modelos. */
export function buildCroquiDocxParagraphs(narrative: string, atpInQuerencia = false): string[] {
  const text = narrative.replace(/\s+/g, " ").trim();
  if (!atpInQuerencia) return [text];
  const introEnd = text.indexOf(". ");
  if (introEnd < 0) return [text];
  const intro = text.slice(0, introEnd + 1);
  const body = text.slice(introEnd + 2).trim();
  if (!body) return [intro];
  return [intro, body];
}
