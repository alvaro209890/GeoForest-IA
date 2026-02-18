// Quick script to inspect WMS layer names
const WMS = "https://geo.sema.mt.gov.br/geoserver/ows?service=WMS&request=GetCapabilities&version=1.3.0&authkey=541085de-9a2e-454e-bdba-eb3d57a2f492";

async function main() {
    console.log("Fetching WMS capabilities...");
    const res = await fetch(WMS);
    const xml = await res.text();
    console.log(`XML length: ${xml.length}`);

    // Extract all <Name> values
    const re = /<Name>\s*([^<]+)\s*<\/Name>/gi;
    const names = [];
    let m;
    while ((m = re.exec(xml))) {
        names.push(m[1].trim());
    }
    console.log(`\nTotal <Name> tags: ${names.length}`);

    // Layer names with ":"  (renderable)
    const renderable = names.filter(n => n.includes(":"));
    console.log(`Renderable (has ':'): ${renderable.length}`);

    // ALL Geoportal layers
    const geo = renderable.filter(n => n.toLowerCase().startsWith("geoportal:"));
    console.log(`\n=== Geoportal layers (${geo.length}) ===`);
    geo.forEach(n => console.log(`  ${n}`));

    // SIMCAR / CAR layers
    const simcar = renderable.filter(n => /geoportal:(simcar|car)/i.test(n));
    console.log(`\n=== SIMCAR/CAR layers (${simcar.length}) ===`);
    simcar.forEach(n => console.log(`  ${n}`));

    // Group names (no :)
    const groups = names.filter(n => !n.includes(":"));
    console.log(`\n=== Group names (no ':') (${groups.length}) ===`);
    groups.forEach(n => console.log(`  ${n}`));
}

main().catch(console.error);
