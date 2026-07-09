import { build } from "vite";

process.env.GEOFOREST_BUILD_TARGET = "admin";

await build();
