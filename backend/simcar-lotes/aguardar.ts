/**
 * Espera o SIMCAR ficar livre, reportando o motivo no progresso do job.
 *
 * A conta do SIMCAR é compartilhada e de sessão única: se alguém está logado no
 * navegador (monitor-car.web.app mostra EM USO), logar aqui derrubaria a pessoa.
 * Então o job espera — sem prazo, mas cancelável — e começa sozinho quando
 * liberar (requisitos R1/R3 do plano docs/planos/simcar-monitor/).
 */
import { isCancelRequested } from "../processing-jobs";
import { lerOcupacaoSimcar, monitorHabilitado, monitorPollMs } from "./monitor";
import { progress } from "./sse";

export type MotivoEspera = "antes_de_logar" | "sessao_interrompida";

const NOTA_BACKGROUND =
  "O download continua em segundo plano mesmo se você fechar esta página.";

export function mensagemDeEspera(motivo: MotivoEspera, por?: string): string {
  return motivo === "sessao_interrompida"
    ? `Sessão interrompida por ${por || "outro login"} — o download continua automaticamente quando o SIMCAR ficar livre. ${NOTA_BACKGROUND}`
    : `SIMCAR em uso por ${por || "outro usuário"} — aguardando ficar livre. ${NOTA_BACKGROUND}`;
}

const dormir = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fica em loop enquanto o monitor disser EM USO. Sai quando o SIMCAR libera
 * (`interrompido: false`) ou quando o usuário cancela (`interrompido: true`).
 * Com o monitor desligado (`SIMCAR_MONITOR_ENABLED=0`) retorna na hora.
 */
export async function aguardarSimcarLivre(args: {
  uid: string;
  jobId: string;
  motivo: MotivoEspera;
  /** Quem estava usando, quando já se sabe (evita um "outro usuário" genérico). */
  por?: string;
  /** Percent congelado da barra — o front mostra spinner, não progresso. */
  percent?: number;
}): Promise<{ interrompido: boolean; esperou: boolean }> {
  if (!monitorHabilitado()) return { interrompido: false, esperou: false };

  let esperou = false;
  for (;;) {
    if (isCancelRequested(args.jobId)) return { interrompido: true, esperou };

    const status = await lerOcupacaoSimcar();
    if (!status.ocupado) return { interrompido: false, esperou };

    esperou = true;
    const por = status.por || args.por;
    progress(args.uid, args.jobId, {
      status: "processing",
      fase: args.motivo === "sessao_interrompida" ? "sessao_interrompida" : "aguardando_simcar",
      por: por || null,
      desde: status.desde || null,
      aguardandoDesde: new Date().toISOString(),
      message: mensagemDeEspera(args.motivo, por),
      ...(args.percent === undefined ? {} : { percent: args.percent }),
    });

    if (isCancelRequested(args.jobId)) return { interrompido: true, esperou };
    await dormir(monitorPollMs());
  }
}
