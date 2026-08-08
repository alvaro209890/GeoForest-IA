/**
 * Mapeamento de atributos — leitura de schemas DBF template e
 * tradução de campos entre shapefiles de origem e destino.
 * Extraído de simcar-clip.ts (Plano 02, Passo 4).
 */
import path from "path";
import { parseDbfSchema, type DbfFieldDef } from "../shapefile-writer";

/* ─── Template Schema Reading ────────────────────────────── */

/** Extract DBF schemas from a set of ZIP entries (modelo ZIP). */
export function readTemplateSchemas(
    modeloEntries: Array<{ name: string; data: Buffer }>,
): Map<string, DbfFieldDef[]> {
    const schemas = new Map<string, DbfFieldDef[]>();

    for (const entry of modeloEntries) {
        if (!entry.name.toLowerCase().endsWith(".dbf")) continue;
        const baseName = path.basename(entry.name, path.extname(entry.name)).toUpperCase();
        try {
            const fields = parseDbfSchema(entry.data);
            if (fields.length > 0) {
                schemas.set(baseName, fields);
            }
        } catch {
            // Skip unparseable DBFs
        }
    }

    return schemas;
}

/* ─── Attribute Translation ──────────────────────────────── */

/**
 * Nomes que o WFS da SEMA usa para campos que o modelo do SIMCAR chama de outro
 * jeito. Sem isso, `SITUACAO`/`AVERBACAO` da ARL chegavam sempre nulos e eram
 * preenchidos com um valor fixo — apagando a distinção entre reserva
 * preservada ("P") e a recuperar ("A"), que é justamente o que o Anexo 01 usa
 * para decidir se a ARL precisa coincidir com a AVN.
 */
const SOURCE_FIELD_ALIASES: Record<string, string[]> = {
    situacao: ["situacao_vegetal", "situacao_veg", "sit_vegeta"],
    averbacao: ["situacao_averbacao", "sit_averba"],
    identific: ["identificacao", "identifica"],
};

/** Map source properties to target DBF fields (case-insensitive). */
export function mapAttributes(
    properties: Record<string, unknown>,
    targetFields: DbfFieldDef[],
): Record<string, string | number | null> {
    const mapped: Record<string, string | number | null> = {};
    const propsLower = new Map(
        Object.entries(properties).map(([k, v]) => [k.toLowerCase(), v]),
    );

    for (const field of targetFields) {
        const lowerName = field.name.toLowerCase();
        let value = propsLower.get(lowerName);
        if (value === undefined || value === null) {
            for (const alias of SOURCE_FIELD_ALIASES[lowerName] || []) {
                const aliasValue = propsLower.get(alias);
                if (aliasValue !== undefined && aliasValue !== null) {
                    value = aliasValue;
                    break;
                }
            }
        }
        if (value === undefined || value === null) {
            mapped[field.name] = null;
        } else if (field.type === "N" || field.type === "F") {
            const num = Number(value);
            mapped[field.name] = Number.isFinite(num) ? num : null;
        } else if (field.type === "D") {
            mapped[field.name] = String(value);
        } else {
            mapped[field.name] = String(value);
        }
    }

    return mapped;
}

/** Set a single field value on a mapped attributes object (case-insensitive field lookup). */
export function setMappedAttribute(
    attributes: Record<string, string | number | null>,
    targetFields: DbfFieldDef[],
    fieldName: string,
    value: string | number | null,
): void {
    const field = targetFields.find((item) => item.name.toLowerCase() === fieldName.toLowerCase());
    if (!field) return;
    attributes[field.name] = value;
}

/**
 * Preenche o campo só quando a origem não trouxe valor. Usado nas regras por
 * camada, que antes sobrescreviam o atributo real vindo do WFS.
 */
function setMappedAttributeIfEmpty(
    attributes: Record<string, string | number | null>,
    targetFields: DbfFieldDef[],
    fieldName: string,
    value: string | number | null,
): void {
    const field = targetFields.find((item) => item.name.toLowerCase() === fieldName.toLowerCase());
    if (!field) return;
    const current = attributes[field.name];
    if (current === null || current === undefined || String(current).trim() === "") {
        attributes[field.name] = value;
    }
}

/* ─── Layer-Specific Attribute Rules ─────────────────────── */

/** Apply SIMCAR-specific attribute rules based on layer name. */
export function applyLayerAttributeRules(
    layerName: string,
    attributes: Record<string, string | number | null>,
    targetFields: DbfFieldDef[],
    recordNumber: number,
): Record<string, string | number | null> {
    // Os defaults abaixo são preenchimento de lacuna, não sobrescrita: quando o
    // WFS traz o atributo real (SITUACAO_VEGETAL="A" numa reserva a recuperar,
    // por exemplo), é ele que vale.
    if (layerName === "AVN") {
        setMappedAttributeIfEmpty(attributes, targetFields, "SITUACAO", "P");
    }

    if (layerName === "ARL") {
        setMappedAttributeIfEmpty(attributes, targetFields, "AVERBACAO", "NA");
        setMappedAttributeIfEmpty(attributes, targetFields, "SITUACAO", "P");
        setMappedAttributeIfEmpty(attributes, targetFields, "IDENTIFIC", recordNumber);
    }

    if (layerName === "RESERVATORIO_ARTIFICIAL") {
        setMappedAttribute(attributes, targetFields, "FAIXA_APP", 30);
    }

    return attributes;
}
