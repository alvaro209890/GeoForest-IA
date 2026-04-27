import { fetchTextWithTimeout, buildWfsUrl } from "./wfs-intersection.ts";

async function run() {
  const url = buildWfsUrl({
    service: "WFS",
    version: "2.0.0",
    request: "GetCapabilities",
  });
  console.log("Fetching Capabilities from", url.toString());
  const xml = await fetchTextWithTimeout(url, 25000);
  const simcarLayers = xml.match(/<Name>([^<]+simcar[^<]+)<\/Name>/ig);
  console.log("SIMCAR Layers:", Array.from(new Set(simcarLayers)));
}

run().catch(console.error);
