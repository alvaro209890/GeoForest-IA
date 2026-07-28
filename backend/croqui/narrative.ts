import { formatDistance } from "./coords";
import type { CroquiLandmark } from "./landmarks";
import type { CroquiRoute } from "./routing";

export function buildCroquiNarrative(args: {
  municipioNome: string;
  propertyName: string;
  landmark: CroquiLandmark;
  route: CroquiRoute;
  startDms: string;
}): string {
  const { municipioNome, propertyName, landmark, route, startDms } = args;
  const mun = municipioNome.trim() || "MT";
  const introSuffix =
    landmark.introSuffix ||
    (landmark.label ? `na ${landmark.label}` : "em ponto de referência municipal");

  const parts: string[] = [];
  parts.push(
    `Inicia-se o croqui no município de ${mun} – MT ${introSuffix}, no ponto ${startDms}.`,
  );

  const steps = route.waypoints.filter((w) => w.distanceFromPrevM > 0 || w.instruction.includes("Chegada"));
  for (let i = 0; i < steps.length; i++) {
    const w = steps[i];
    if (w.instruction.includes("Chegada")) {
      parts.push(
        `Onde se encontra a sede da propriedade ${propertyName.trim() || "rural"}, no ponto ${w.dms}.`,
      );
      continue;
    }
    const dist = formatDistance(w.distanceFromPrevM);
    const road = w.roadName && w.roadName !== "-" ? ` pela ${w.roadName}` : "";
    let verb = "Siga";
    if (w.instruction.includes("esquerda")) verb = "Vire à esquerda e siga";
    else if (w.instruction.includes("direita")) verb = "Vire à direita e siga";
    else if (w.instruction.includes("frente")) verb = "Siga em frente";
    else if (w.instruction.includes("rotatória")) verb = "Na rotatória, siga";
    else if (w.instruction.includes("bifurcação")) verb = "Na bifurcação, siga";
    parts.push(`${verb}${road} por ${dist} até o ponto ${w.dms}.`);
  }

  if (!parts[parts.length - 1]?.includes("sede da propriedade")) {
    const last = route.waypoints[route.waypoints.length - 1];
    if (last) {
      parts.push(
        `Onde se encontra a sede da propriedade ${propertyName.trim() || "rural"}, no ponto ${last.dms}.`,
      );
    }
  }

  return parts.join("\n");
}
