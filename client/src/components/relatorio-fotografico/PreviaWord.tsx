/**
 * Miniatura das páginas do Word, desenhada com a mesma paginação do backend
 * (`shared/relatorio-fotografico/layout.ts`). O fundo é o papel timbrado do
 * modelo IMAP, reduzido.
 */
import { useMemo } from 'react';
import {
  PAGINA_CM,
  planPhotoPages,
  textoFigura,
} from '../../../../shared/relatorio-fotografico/layout';
import type { FotoLocal, ParcialLocal } from './fotos';

const LARGURA_PX = 196;
const PX_POR_CM = LARGURA_PX / PAGINA_CM.w;
const ALTURA_PX = PAGINA_CM.h * PX_POR_CM;

function Folha({ fundo, numero, children }: { fundo: string; numero: number; children?: React.ReactNode }) {
  return (
    <div className="flex shrink-0 flex-col items-center gap-1.5">
      <div
        className="relative shrink-0 overflow-hidden rounded-sm bg-white bg-cover shadow-lg shadow-black/40"
        style={{ width: LARGURA_PX, height: ALTURA_PX, backgroundImage: `url(${fundo})` }}
      >
        {children}
      </div>
      <span className="text-[10px] text-slate-500">Página {numero}</span>
    </div>
  );
}

export function contarPaginas(parciais: ParcialLocal[], porId: Map<string, FotoLocal>): number {
  const paginas = planPhotoPages(
    parciais.map((parcial) => ({
      caption: parcial.legenda,
      photos: parcial.fotoIds
        .map((id) => porId.get(id))
        .filter((foto): foto is FotoLocal => Boolean(foto)),
    })),
  );
  return paginas.length ? 1 + paginas.length : 0;
}

export default function PreviaWord({
  parciais,
  porId,
}: {
  parciais: ParcialLocal[];
  porId: Map<string, FotoLocal>;
}) {
  const paginas = useMemo(
    () =>
      planPhotoPages(
        parciais.map((parcial) => ({
          caption: parcial.legenda.trim() || '(escreva a legenda)',
          photos: parcial.fotoIds
            .map((id) => porId.get(id))
            .filter((foto): foto is FotoLocal => Boolean(foto)),
        })),
      ),
    [parciais, porId],
  );

  if (!paginas.length) {
    return <p className="text-xs text-slate-500">A prévia aparece quando houver fotos no relatório.</p>;
  }

  return (
    <div className="grid max-h-[68vh] grid-cols-[repeat(auto-fill,minmax(196px,1fr))] justify-items-center gap-4 overflow-y-auto pr-1 custom-scrollbar">
      <Folha fundo="/relatorio-fotografico/capa.jpg" numero={1} />
      {paginas.map((pagina, indice) => (
        <Folha key={indice} fundo="/relatorio-fotografico/pagina.jpg" numero={indice + 2}>
          {pagina.blocks.flatMap((bloco) =>
            bloco.items.map((item) => {
              const larguraPx = item.fit.w * PX_POR_CM;
              const colunaPx = item.columnCm * PX_POR_CM;
              const legenda = textoFigura(item.number, item.caption);
              return (
                <div
                  key={item.photo.id}
                  className="absolute flex flex-col items-center"
                  style={{
                    left: (item.centerCm * PX_POR_CM) - colunaPx / 2,
                    top: bloco.topCm * PX_POR_CM,
                    width: colunaPx,
                  }}
                  title={legenda}
                >
                  <img
                    src={item.photo.previewUrl}
                    alt={item.photo.nome}
                    style={{ width: larguraPx, height: item.fit.h * PX_POR_CM }}
                    className="object-cover"
                  />
                  <p
                    className="mt-[1px] line-clamp-3 text-center leading-[1.2] text-neutral-800"
                    style={{ fontSize: 4.2 }}
                  >
                    {legenda}
                  </p>
                </div>
              );
            }),
          )}
        </Folha>
      ))}
    </div>
  );
}
