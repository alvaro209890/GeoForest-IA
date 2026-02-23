import { FileText } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

type TermsOfUseDialogProps = {
  triggerLabel?: string;
  triggerClassName?: string;
};

const TERMS_LAST_UPDATED = '23/02/2026';

export default function TermsOfUseDialog({
  triggerLabel = 'Ver Termos de Uso',
  triggerClassName,
}: TermsOfUseDialogProps) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className={
            triggerClassName ||
            'inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs text-slate-200 hover:bg-white/10 transition-colors'
          }
        >
          <FileText size={14} />
          {triggerLabel}
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-[calc(100%-1rem)] sm:max-w-3xl bg-[#0e1612] border border-white/15 text-slate-100">
        <DialogHeader>
          <DialogTitle className="text-base sm:text-lg">Termos de Uso - GeoForest IA</DialogTitle>
          <DialogDescription className="text-xs text-slate-400">
            Ultima atualizacao: {TERMS_LAST_UPDATED}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[65vh] overflow-y-auto pr-1 custom-scrollbar space-y-4 text-sm">
          <section className="space-y-1">
            <h4 className="text-slate-200 font-semibold">1. Aceitacao</h4>
            <p className="text-slate-300">
              Ao criar conta e usar a plataforma GeoForest IA, voce concorda com estes Termos de Uso. Se nao concordar,
              nao utilize o servico.
            </p>
          </section>

          <section className="space-y-1">
            <h4 className="text-slate-200 font-semibold">2. Objeto da plataforma</h4>
            <p className="text-slate-300">
              A plataforma oferece assistente de IA, analise de imagens de satelite, processamento de shapefiles,
              cruzamentos com camadas geoespaciais e geracao de relatorios tecnicos para apoio a rotinas ambientais e
              florestais.
            </p>
          </section>

          <section className="space-y-1">
            <h4 className="text-slate-200 font-semibold">3. Cadastro e acesso</h4>
            <p className="text-slate-300">
              O acesso depende de autenticacao valida e cadastro ativo no sistema. Voce e responsavel por manter seus
              dados corretos e proteger suas credenciais.
            </p>
          </section>

          <section className="space-y-1">
            <h4 className="text-slate-200 font-semibold">4. Uso permitido e responsabilidades</h4>
            <p className="text-slate-300">
              Voce declara que possui autorizacao para enviar arquivos, geometrias e imagens processados na plataforma.
              E proibido usar o servico para violar leis, direitos de terceiros ou realizar engenharia reversa maliciosa.
            </p>
          </section>

          <section className="space-y-1">
            <h4 className="text-slate-200 font-semibold">5. Dados e integracoes</h4>
            <p className="text-slate-300">
              O sistema utiliza Firebase (autenticacao e persistencia), Cloudinary (arquivos e imagens) e provedores de
              IA para processamento das analises. Parte do processamento pode ocorrer em servicos de terceiros conforme
              necessidade tecnica.
            </p>
          </section>

          <section className="space-y-1">
            <h4 className="text-slate-200 font-semibold">6. Privacidade e retencao</h4>
            <p className="text-slate-300">
              Conversas, resultados e anexos podem ser armazenados para execucao do servico, historico e auditoria
              tecnica. O usuario deve evitar envio de dados sem base legal. O tratamento deve observar a LGPD e normas
              aplicaveis.
            </p>
          </section>

          <section className="space-y-1">
            <h4 className="text-slate-200 font-semibold">7. Cobranca e creditos</h4>
            <p className="text-slate-300">
              O consumo pode gerar debitacao de creditos por uso de IA, processamento e armazenamento. Valores, saldo e
              movimentacoes sao exibidos na area de configuracoes.
            </p>
          </section>

          <section className="space-y-1">
            <h4 className="text-slate-200 font-semibold">8. Limites tecnicos e disponibilidade</h4>
            <p className="text-slate-300">
              A plataforma depende de servicos externos (APIs, WMS/WFS e provedores de IA). Podem ocorrer indisponibilidade,
              latencia, falhas temporarias ou variacao de resultados.
            </p>
          </section>

          <section className="space-y-1">
            <h4 className="text-slate-200 font-semibold">9. Natureza de apoio tecnico</h4>
            <p className="text-slate-300">
              As respostas da IA sao apoio tecnico e nao substituem analise profissional, vistoria de campo ou parecer
              juridico. A decisao final e a responsabilidade sobre laudos e protocolos sao do usuario responsavel tecnico.
            </p>
          </section>

          <section className="space-y-1">
            <h4 className="text-slate-200 font-semibold">10. Propriedade intelectual</h4>
            <p className="text-slate-300">
              O software, interface e fluxos da plataforma sao protegidos por direitos de propriedade intelectual. O usuario
              mantem titularidade sobre os dados proprios enviados, observadas licencas de terceiros incidentes.
            </p>
          </section>

          <section className="space-y-1">
            <h4 className="text-slate-200 font-semibold">11. Alteracoes destes termos</h4>
            <p className="text-slate-300">
              Estes termos podem ser atualizados para refletir mudancas legais, tecnicas ou operacionais. A versao vigente
              sera sempre a exibida no sistema.
            </p>
          </section>

          <section className="space-y-1">
            <h4 className="text-slate-200 font-semibold">12. Contato</h4>
            <p className="text-slate-300">
              Para duvidas sobre uso, dados ou seguranca, utilize o canal de suporte oficial do projeto.
            </p>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
