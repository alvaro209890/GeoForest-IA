import { formatDistance } from "./coords";
import type { CroquiLandmark } from "./landmarks";
import type { CroquiRoute, RouteWaypoint } from "./routing";

/**
 * Roteiro no padrão dos croquis modelo: parágrafo corrido em que cada trecho
 * traz a distância percorrida seguida do DMS do ponto de CHEGADA desse trecho.
 *
 *   Inicia-se o croqui na MT-243, no ponto (A).
 *   Siga em frente por 1,1 km até o ponto (B).
 *   Vire à direita e siga por 5,1 km até o ponto (C).
 *   O destino estará à esquerda.
 */

function comVia(road: string): string {
  const clean = String(road || "").trim();
  return clean && clean !== "-" ? ` pela ${clean}` : "";
}

/** Frase de um trecho: sai da manobra de `from` e termina no ponto `to`. */
function legPhrase(
  from: RouteWaypoint,
  to: RouteWaypoint,
  isFirst: boolean,
  omitRoad = false,
): string {
  const dist = formatDistance(from.distanceToNextM);
  const via = omitRoad ? "" : comVia(from.roadName);
  const destino = `até o ponto ${to.dms}`;

  if (isFirst || from.maneuver === "depart") {
    return `Siga em frente${via} por ${dist} ${destino}.`;
  }
  if (from.maneuver === "left" || from.maneuver === "right") {
    const lado = from.maneuver === "left" ? "esquerda" : "direita";
    return via
      ? `Vire à ${lado} e siga em frente${via} por ${dist} ${destino}.`
      : `Vire à ${lado} e siga por ${dist} ${destino}.`;
  }
  if (from.maneuver === "roundabout") {
    return `Na rotatória, siga${via || " em frente"} por ${dist} ${destino}.`;
  }
  if (from.maneuver === "fork") {
    return `Na bifurcação, siga em frente${via} por ${dist} ${destino}.`;
  }
  if (from.maneuver === "merge") {
    return `Entre${via || " na via"} e siga por ${dist} ${destino}.`;
  }
  return `Siga em frente${via} por ${dist} ${destino}.`;
}

/**
 * Abertura do roteiro. `usouVia` avisa que a via já foi nomeada aqui — nos
 * modelos, o primeiro trecho não a repete ("Inicia-se o croqui na MT-243...
 * Siga em frente por 1,1 km...").
 */
function introPhrase(args: {
  municipioNome: string;
  landmark: CroquiLandmark;
  primeiraVia: string;
  startDms: string;
}): { text: string; usouVia: boolean } {
  const { municipioNome, landmark, primeiraVia, startDms } = args;
  if (landmark.fonte === "curado" && landmark.introSuffix) {
    return {
      text: `Inicia-se o croqui ${landmark.introSuffix}, no ponto ${startDms}.`,
      usouVia: false,
    };
  }
  if (primeiraVia) {
    return {
      text: `Inicia-se o croqui na ${primeiraVia}, no ponto ${startDms}.`,
      usouVia: true,
    };
  }
  const suffix = landmark.introSuffix || `no município de ${municipioNome} – MT`;
  return { text: `Inicia-se o croqui ${suffix}, no ponto ${startDms}.`, usouVia: false };
}

export function buildCroquiNarrative(args: {
  municipioNome: string;
  propertyName: string;
  landmark: CroquiLandmark;
  route: CroquiRoute;
}): string {
  const { landmark, route } = args;
  const municipioNome = args.municipioNome.trim() || "Mato Grosso";
  const waypoints = route.waypoints;

  if (!waypoints.length) {
    return `Inicia-se o croqui no município de ${municipioNome} – MT. Onde se encontra a propriedade.`;
  }

  const intro = introPhrase({
    municipioNome,
    landmark,
    primeiraVia: String(waypoints[0].roadName || "").trim(),
    startDms: waypoints[0].dms,
  });
  const parts: string[] = [intro.text];

  const legs: string[] = [];
  for (let i = 0; i < waypoints.length - 1; i++) {
    if (waypoints[i].distanceToNextM <= 0) continue;
    const isFirst = legs.length === 0;
    legs.push(legPhrase(waypoints[i], waypoints[i + 1], isFirst, isFirst && intro.usouVia));
  }

  if (!legs.length) {
    parts.push("Onde se encontra a propriedade.");
    return parts.join(" ");
  }

  if (route.arrivalSide) {
    parts.push(...legs, `O destino estará à ${route.arrivalSide}.`);
  } else {
    legs[legs.length - 1] = legs[legs.length - 1].replace(
      /\.$/,
      ", onde se encontra a propriedade.",
    );
    parts.push(...legs);
  }

  return parts.join(" ");
}

/** O DOCX modelo é um parágrafo único com o mesmo texto do PDF. */
export function buildCroquiDocxParagraphs(narrative: string): string[] {
  const text = narrative.replace(/\s+/g, " ").trim();
  return text ? [text] : [""];
}
