# Armazenamento: JSON local "disfarçado" de Firestore

> Leia isto antes de mexer em qualquer coisa que pareça "Firestore" neste projeto.
> O app **não usa o Cloud Firestore real**. Existe só um `firebase.json` com `hosting`
> (sem seção `firestore`), e o Firebase é usado apenas para **Auth** e **Hosting**.

## TL;DR

- Toda a persistência de dados de usuário (perfil, conversas, jobs de SIMCAR/vértices/
  containment/geometria/CBERS/Landsat, recibos etc.) é feita em **arquivos JSON no disco**,
  não em um banco de dados.
- O código do frontend **parece** usar o SDK do Firestore (`collection()`, `doc()`,
  `getDoc()`, `setDoc()`, `query()`, `orderBy()`...), mas na verdade importa esses nomes de
  `client/src/lib/localFirestore.ts` — um shim escrito à mão que imita a API do Firestore e
  faz `fetch()` para o backend.
- `client/src/lib/firebase.ts` exporta `export const db = {}` — um objeto vazio, só mantido
  por compatibilidade de assinatura. Ele não é usado para nada além de ser passado como
  primeiro argumento (ignorado) para `collection(db, ...)`.
- No backend, tudo isso cai em `backend/local-storage.ts`, que resolve `["users", uid,
  "colecao", "docId"]` para um caminho de arquivo dentro de `STORAGE_ROOT` e lê/escreve JSON
  com `fs`.

Se você (ou outro agente de IA) ver `import { db } from '@/lib/firebase'` e `collection(db,
'users', uid, 'algo')` no `Dashboard.tsx`, **não é Firestore de verdade**. É o mesmo
armazenamento local do backend, só que acessado via HTTP.

## Onde os dados ficam no disco

```
STORAGE_ROOT = process.env.LOCAL_DATA_ROOT || "/media/server/HD Backup/Servidores_NAO_MEXA/Banco_de_dados/GeoForest"

STORAGE_ROOT/
└── users/
    └── <uid>/
        ├── profile.json                  # doc solo (users/{uid})
        ├── settings/preferences.json     # doc solo (users/{uid}/settings/preferences)
        ├── conversations/<id>.json       # collection
        ├── simcar_clips/<id>.json        # collection
        ├── vertices_jobs/<id>.json       # collection
        ├── containment_jobs/<id>.json    # collection
        ├── geometry_errors_jobs/<id>.json# collection
        ├── cbers_wpm_jobs/<id>.json      # collection
        ├── landsat_jobs/<id>.json        # collection
        ├── processing_jobs/<id>.json     # collection
        ├── receipts/<id>.json            # collection
        ├── attachments/images|pdfs/...   # buffers (não são "docs")
        ├── simcar/{input,output,context,analysis}/...  # buffers de job
        ├── vertices/{input,output}/...
        ├── containment/{input,output}/...
        ├── geometry-errors/{input,output}/...
        ├── cbers/output/...
        └── trash/
```

**Isso é o HD de backup (`Servidores_NAO_MEXA`), não a SSD do servidor.** Não recrie esse
caminho manualmente nem aponte `LOCAL_DATA_ROOT` para outro lugar sem necessidade — é onde
ficam os dados reais de todos os usuários em produção.

## As duas portas de entrada (mesmo armazenamento)

### 1. Backend chamando direto (jobs pesados)

Módulos como `simcar-clip.ts`, `geometry-errors.ts`, `vertices-proximas.ts`,
`containment-analysis.ts`, `cbers-wpm.ts`, `landsat.ts` chamam
`writeDocBySegments`/`readDocBySegments` diretamente, dentro do próprio processo Node, para
salvar o progresso e o resultado do job (SSE de progresso, retomar job após restart do
serviço, etc.). Exemplo (`geometry-errors.ts`):

```ts
function persistGeometryJob(uid: string, jobId: string, patch: Record<string, unknown>): void {
  writeDocBySegments(
    ["users", uid, "geometry_errors_jobs", jobId],
    stripUndefinedDeep({ jobId, ...patch, updatedAtMs: Date.now() }),
    { merge: true },
  );
}
```

### 2. Frontend via shim REST (histórico/UI entre sessões)

O `Dashboard.tsx` usa a "API Firestore" (`localFirestore.ts`) para espelhar o snapshot do
job assim que chega via SSE, e para carregar o histórico de análises quando o usuário loga.
Isso é o que faz o item aparecer na lista lateral de "Análises" e sobreviver a um F5/relogin.
Exemplo (bloco de containment em `Dashboard.tsx`, o mesmo padrão vale para SIMCAR clip,
vértices e erros de geometria):

```tsx
<ContainmentAnalysis
  apiFetch={apiFetch}
  onJobSnapshot={(job) => {
    const item = mapContainmentDocToHistoryItem(String(job?.jobId || job?.id || ''), job);
    setContainmentHistory(/* ...atualiza lista local... */);
    if (containmentJobsRef) {
      void setDoc(doc(containmentJobsRef, item.jobId), { ...job, updatedAtMs: Date.now() }, { merge: true }).catch(() => {});
    }
  }}
/>
```

`localFirestore.ts` traduz isso para:

```
GET    /api/store/doc?path=users/<uid>/geometry_errors_jobs/<jobId>
PUT    /api/store/doc?path=users/<uid>/geometry_errors_jobs/<jobId>   { data, merge }
DELETE /api/store/doc?path=users/<uid>/geometry_errors_jobs/<jobId>
GET    /api/store/collection?path=users/<uid>/geometry_errors_jobs&orderBy=updatedAtMs&direction=desc
```

Essas rotas genéricas (`backend/index.ts`, perto de `/api/store/doc` e
`/api/store/collection`) também passam por `writeDocBySegments` / `readDocBySegments` /
`listCollectionBySegments` — ou seja, **é o mesmo arquivo JSON** que o backend já escreveu
diretamente no passo 1. O `setDoc` do frontend normalmente é redundante com o que o backend
já persistiu (mesmo `merge: true`), mas é o que garante que o `updatedAtMs` fique fresco pra
ordenação e que o item apareça na collection listada pelo frontend.

## A whitelist de collections — a pegadinha que já mordeu este projeto

`backend/local-storage.ts` só resolve um caminho de doc/collection se o terceiro segmento
(`users/<uid>/<collection>/<docId>`) estiver numa lista fixa, duplicada em duas funções:

```ts
// resolveDocPathFromSegments E resolveCollectionDirFromSegments
const allowed = new Set([
  "conversations", "simcar_clips", "cbers_wpm_jobs", "landsat_jobs",
  "vertices_jobs", "processing_jobs", "containment_jobs",
  "geometry_errors_jobs", "receipts",
]);
```

Se o nome da collection não estiver nessa lista, `writeDocBySegments` lança
`throw new Error("INVALID_DOC_PATH")` e `readDocBySegments`/`listCollectionBySegments`
simplesmente retornam vazio/nulo — **sem avisar que a collection é desconhecida**.

**Isso já causou um bug real (2026-07-13):** a aba "Erros de Geometria" foi implementada
usando a collection `geometry_errors_jobs`, mas ninguém adicionou esse nome na whitelist.
Resultado: todo upload de `.zip` nessa aba quebrava imediatamente com `INVALID_DOC_PATH`
(rota `POST /api/geometry-errors/upload`), porque a primeira coisa que a rota faz depois de
salvar o zip é gravar o doc do job. Corrigido adicionando `"geometry_errors_jobs"` nas duas
listas. Ver `docs/CHANGELOG_2026-07-13_GEOMETRY_ERRORS_STORAGE.md`.

**Se você criar uma nova collection de job, adicione o nome nas DUAS listas em
`backend/local-storage.ts` antes de testar.** Não existe validação/erro claro além do
`INVALID_DOC_PATH` genérico — é fácil perder um dia inteiro achando que é bug no parser do
shapefile quando na verdade é isso.

## Checklist: como adicionar uma nova aba de análise/job (padrão SIMCAR/vértices/containment/geometria)

Ao copiar o padrão de uma análise existente (ex.: "Erros de Geometria") pra uma nova, siga
esta ordem — é exatamente o que faltou/foi corrigido em 2026-07-13:

1. **Backend**
   - Escolha um nome de collection, ex. `minha_analise_jobs`.
   - Adicione esse nome em `allowed` nas duas funções de `backend/local-storage.ts`
     (`resolveDocPathFromSegments` e `resolveCollectionDirFromSegments`).
   - No módulo do job (`backend/minha-analise.ts`), persista progresso/resultado com
     `writeDocBySegments(["users", uid, "minha_analise_jobs", jobId], patch, { merge: true })`.
   - Exponha rotas REST: upload → processar (SSE de progresso) → resultado/download,
     seguindo o padrão de `geometry-errors.ts` (`/api/minha-analise/upload`,
     `/api/minha-analise/process`, `/api/minha-analise/jobs/:id/events`).

2. **Componente React** (`client/src/components/MinhaAnalise.tsx`)
   - Prop `onJobSnapshot?: (job: Record<string, unknown>) => void`.
   - Chame `onJobSnapshot?.(job)` no fim do `applySnapshot` (mesmo objeto recebido via SSE,
     que já inclui `jobId`).

3. **`Dashboard.tsx`**
   - Novo estado: `minhaAnaliseHistory`, `minhaAnaliseJobId`, `minhaAnaliseJobsRef`
     (`collection(db, 'users', uid, 'minha_analise_jobs')`, criado no `onAuthStateChanged`).
   - `mapMinhaAnaliseDocToHistoryItem(docId, data)` — mesmo formato de
     `mapContainmentDocToHistoryItem`/`mapGeometryDocToHistoryItem`.
   - Carregar histórico salvo no `onAuthStateChanged` (`getDocs(query(ref,
     orderBy('updatedAtMs', 'desc')))`), filtrando `status !== 'uploaded' && status !==
     'deleted'`, e retomar job em `processing` se houver.
   - Passar `onJobSnapshot` pro componente, espelhando o job em `minhaAnaliseJobsRef` via
     `setDoc(doc(ref, jobId), { ...job, updatedAtMs: Date.now() }, { merge: true })`.
   - Adicionar um branch na lista lateral (histórico) do painel de análises, com botão de
     excluir (`deleteDoc(doc(ref, jobId))`).

Pular o passo 1 (whitelist) é o erro mais fácil de cometer e o mais silencioso — o upload
falha com uma mensagem genérica e nada nos logs aponta pra "esqueceu de registrar a
collection".

## Autenticação dessas rotas

`writeDocBySegments`/`readDocBySegments` não checam permissão sozinhos — quem garante que um
usuário só lê/escreve os próprios docs é o prefixo obrigatório `users/<uid>/...` combinado
com o middleware de auth (`backend/auth.ts`, Firebase Admin SDK) que popula `req.authUid` a
partir do ID token, e a checagem `pathSegments[1] !== uid → 403` nas rotas genéricas
`/api/store/doc` e `/api/store/collection` (`backend/index.ts`). Rotas dedicadas (SIMCAR
clip, geometria etc.) fazem o mesmo: sempre usam `req.authUid`, nunca um uid vindo do body/
query.
