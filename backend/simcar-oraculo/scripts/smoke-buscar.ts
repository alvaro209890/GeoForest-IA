/**
 * Smoke CLI (manual, PC com credenciais):
 *   SIMCAR_CPF=... SIMCAR_SENHA=... npx tsx backend/simcar-oraculo/scripts/smoke-buscar.ts [carId]
 */
import { assertSimcarCredentials } from "../config";
import { getSimcarToken, simcarBuscar, simcarBuscarStatusProcessamento } from "../client";

const carId = process.argv[2] || assertSimcarCredentials().testCarId;

async function main() {
  const cfg = assertSimcarCredentials();
  console.log("testCarId", cfg.testCarId, "requested", carId);
  const token = await getSimcarToken();
  console.log("login ok", token.slice(0, 20) + "…");
  const buscar = await simcarBuscar(token, carId);
  console.log(
    JSON.stringify(
      {
        Id: buscar.Id,
        Nome: buscar.Nome ?? buscar.PropriedadeNome,
        MunicipioTexto: buscar.MunicipioTexto ?? buscar.Municipio,
        Situacao: buscar.Situacao,
      },
      null,
      2,
    ),
  );
  const st = await simcarBuscarStatusProcessamento(token, carId);
  console.log(
    "status",
    st.ImportacaoResultado,
    st.ImportacaoShapeStatus,
    st.ProcessamentoResultado,
    st.ProcessamentoStatus,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
