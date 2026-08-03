import { formatDistance, sentidoCardeal } from "./coords";
import type { CroquiLandmark } from "./landmarks";
import type { CroquiRoute, RouteWaypoint } from "./routing";

/**
 * Roteiro no padrão dos croquis modelo: parágrafo corrido em que cada trecho
 * traz a distância percorrida seguida do DMS do ponto de CHEGADA desse trecho.
 *
 *   O presente croqui se inicia na cidade Querência no ponto (A) seguindo pela
 *   MT-243 no sentido sul.
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
 * Abertura do roteiro, no padrão fixo pedido pelo Álvaro:
 *
 *   O presente croqui se inicia na cidade X no ponto X seguindo pela
 *   rua/avenida/estrada X no sentido X.
 *
 * `usouVia` avisa que a via já foi nomeada aqui — nos modelos, o primeiro
 * trecho não a repete ("...seguindo pela MT-243 no sentido sul. Siga em frente
 * por 1,1 km..."). O `sentido` é o ponto cardeal do primeiro trecho da rota
 * (norte/sul/leste/oeste...).
 */
function introPhrase(args: {
  municipioNome: string;
  landmark: CroquiLandmark;
  primeiraVia: string;
  startDms: string;
  sentido: string | null;
}): { text: string; usouVia: boolean } {
  const { municipioNome, landmark, primeiraVia, startDms, sentido } = args;
  const cidade = municipioNome.trim() || "Mato Grosso";

  const base = `O presente croqui se inicia na cidade ${cidade} no ponto ${startDms}`;

  if (primeiraVia) {
    const s = sentido ? ` no sentido ${sentido}` : "";
    return {
      text: `${base} seguindo pela ${primeiraVia}${s}.`,
      usouVia: true,
    };
  }

  // Sem via nomeada (OSRM não trouxe nome nem sigla): usa o landmark como
  // referência de onde o traçado começa.
  const suffix = landmark.introSuffix || `no município de ${cidade}`;
  const s = sentido ? ` no sentido ${sentido}` : "";
  return {
    text: `${base} seguindo ${suffix}${s}.`,
    usouVia: false,
  };
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
    return `O presente croqui se inicia na cidade ${municipioNome}. Onde se encontra a propriedade.`;
  }

  // Sentido do primeiro trecho: ponto cardeal entre o waypoint inicial e o
  // primeiro waypoint seguinte com deslocamento (ignora paradas intermediárias).
  let sentido: string | null = null;
  for (let i = 0; i < waypoints.length - 1; i++) {
    if (waypoints[i].distanceToNextM > 0) {
      const a = waypoints[i];
      const b = waypoints[i + 1];
      sentido = sentidoCardeal(a.lon, a.lat, b.lon, b.lat);
      break;
    }
  }

  const intro = introPhrase({
    municipioNome,
    landmark,
    primeiraVia: String(waypoints[0].roadName || "").trim(),
    startDms: waypoints[0].dms,
    sentido,
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
