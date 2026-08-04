/**
 * Geometry Errors — barrel público dos detectores de erro geométrico do SIMCAR.
 */
export * from "./types";
export * from "./constants";
export * from "./utils";
export * from "./detectors/duplicate-points";
export * from "./detectors/self-intersection";
export * from "./detectors/overlaps";
export * from "./detectors/gaps";
export * from "./detectors/air";
export * from "./detectors/containment";
export * from "./detectors/forbidden-overlap";
export * from "./detectors/overlapping-rings";
export * from "./detectors/umida-containment";
export * from "./detectors/reservatorio";
export * from "./detectors/complex-polygon";
export * from "./runner";
export * from "./report";
export * from "./sse";
export * from "./job";
export * from "./routes";
