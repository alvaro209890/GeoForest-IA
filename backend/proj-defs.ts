/**
 * Registro global das projeções usadas pelo sistema.
 *
 * `proj4` mantém um registro global de definições; basta este módulo ser
 * importado uma vez para que `proj4("EPSG:4674", ...)` funcione em qualquer
 * outro módulo. Importe-o (mesmo sem usar nada) em todo módulo que chame
 * `proj4` com esses códigos — sem isso, o proj4 lança
 * `Could not parse to valid json: EPSG:4674`.
 */
import proj4 from "proj4";

proj4.defs("EPSG:4674", "+proj=longlat +ellps=GRS80 +no_defs +type=crs");
proj4.defs("EPSG:4326", "+proj=longlat +datum=WGS84 +no_defs +type=crs");

export {};
