# 🌲 GeoForest IA

Sistema de apoio à Engenharia Florestal com inteligência artificial, voltado para licenciamento ambiental, análise espacial e recorte de camadas SIMCAR/SEMA-MT no estado de Mato Grosso.

> **🌐 Acesso público:** Backend exposto via Cloudflare Tunnel
> **API:** `https://geoforest-api.cursar.space`
> **App:** `https://ia-florestal.web.app`
> **Admin CBERS:** `https://geoforest-admin.web.app`
> **WMS:** `https://wms.cursar.space`

---

## 📋 Índice

- [Arquitetura](#arquitetura)
- [Stack](#stack)
- [Estrutura do Projeto](#estrutura-do-projeto)
- [Módulos do Backend](#módulos-do-backend)
- [Correções Recentes](#correções-recentes)
- [Pipeline SIMCAR Clip](#pipeline-simcar-clip)
- [Camadas SIMCAR Recortadas](#camadas-simcar-recortadas)
- [Vértices Próximas](#vértices-próximas)
- [CBERS e WMS Local](#cbers-e-wms-local)
- [Banco de Conhecimento](#banco-de-conhecimento)
- [API - Endpoints](#api---endpoints)
- [Deploy](#deploy)
- [Manutenção](#manutenção)
- [Variáveis de Ambiente](#variáveis-de-ambiente)
- [Documentação Adicional](#documentação-adicional)

---

## Arquitetura

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────────────┐
│  Firebase    │────▶│  GeoForest IA    │◀────│  Cloudflare Tunnel      │
│  Hosting     │     │  (React SPA)     │     │  geoforest-api.cursar   │
│  ia-florestal│     │  ~20k linhas     │     │  .space → localhost:3001│
└─────────────┘     └────────┬─────────┘     └─────────────────────────┘
                             │
                    ┌────────▼─────────┐
                    │  Backend Express  │
                    │  (tsx, 21k linhas)│
                    │  Servidor Local   │
                    │  Porta 3001       │
                    └────────┬─────────┘
                             │
        ┌────────────────────┼────────────────────┐
        ▼                    ▼                    ▼
┌───────────────┐   ┌───────────────┐   ┌──────────────────┐
│  Groq AI      │   │  Gemini       │   │  WMS SEMA-MT     │
│  (LLM chat)   │   │  (visão IA)   │   │  geo.sema.mt.gov │
└───────────────┘   └───────────────┘   └────────┬─────────┘
                                                  │
                                         ┌────────▼────────┐
                                         │  GeoServer       │
                                         │  local:8081      │
                                         │  (Dados CBERS    │
                                         │   e rasters MT)  │
                                         │  Proxy: :8082    │
                                         └─────────────────┘
```

### Infraestrutura (Servidor Local)

O backend roda **exclusivamente em servidor local**, exposto via Cloudflare Tunnel.

| Componente | Porta | Descrição |
|------------|-------|-----------|
| Backend Express | 3001 | API principal (tsx, dev/prod) |
| GeoServer | 8081 | Catálogo de rasters CBERS |
| Proxy Público WMS | 8082 | Proxy que filtra GeoServer para WMS público |
| Cloudflare Tunnel | — | `geoforest-api.cursar.space → localhost:3001` |

**Serviços systemd:**
| Serviço | Descrição |
|---------|-----------|
| `geoforest-backend.service` | Backend Express | 
| `geoserver-wms.service` | GeoServer (Tomcat) |
| `geoserver-wms-public-proxy.service` | Proxy Python do WMS |
| `geoserver-wms-tunnel.service` | Cloudflare Tunnel do WMS |

---

## Stack

### Backend (Express + TypeScript)
- **Runtime:** TypeScript com tsx (execução direta, sem build step)
- **Servidor:** Express 4.x + HTTP Server nativo (`createServer`)
- **LLM Chat:** Groq AI (Llama, Qwen, GPT-OSS, Kimi K2, fallbacks)
- **Visão Computacional:** Google Gemini (análise de imagens de satélite)
- **Geoespacial:** Turf.js, Proj4, GDAL
- **Armazenamento:** Local JSON (estilo Firestore) + Cloudinary (imagens) + Firebase Admin SDK
- **Autenticação:** Firebase Auth (middleware opcional + obrigatório)
- **Relatórios:** PDFKit, ExcelJS
- **Processamento de Imagens:** Sharp

### Frontend (React + Vite)
- **Framework:** React 19 com TypeScript
- **Build:** Vite 7
- **Estilização:** Tailwind CSS 4 + shadcn/ui (~60 componentes)
- **Roteamento:** Wouter
- **Mapa:** Leaflet
- **Autenticação:** Firebase Auth (client SDK)
- **UI/UX:** Framer Motion, Sonner, Lucide Icons, Vaul, Recharts

---

## Estrutura do Projeto

```
GeoForest-IA/
├── backend/                    # ~21.700 linhas TypeScript
│   ├── index.ts               # Servidor Express (2.851 linhas)
│   ├── simcar-clip.ts         # Recorte SIMCAR + análise IA (9.920 linhas)
│   ├── cbers-wpm.ts           # CBERS-4A WPM (2.964 linhas)
│   ├── vertices-proximas.ts   # Análise de vértices próximas em shapefiles
│   ├── knowledge-base.ts      # RAG base conhecimento (1.064 linhas)
│   ├── cbers-archive.ts       # Acervo permanente CBERS (963 linhas)
│   ├── wfs-intersection.ts    # Interseção WFS (660 linhas)
│   ├── local-storage.ts       # Armazenamento local
│   ├── billing.ts             # Cobrança por uso
│   ├── shapefile-writer.ts    # Escrita .shp/.shx/.dbf
│   ├── processing-jobs.ts     # Jobs assíncronos
│   ├── geo-utils.ts           # Utilitários geo
│   ├── firebase-admin.ts      # Firebase Admin SDK
│   └── auth.ts                # Middleware auth
├── client/src/                # ~20.400 linhas TypeScript/TSX
│   ├── App.tsx                # Rotas
│   ├── pages/
│   │   ├── Dashboard.tsx      # App principal (11.737 linhas)
│   │   ├── Auth.tsx           # Login/Cadastro
│   │   └── NotFound.tsx
│   ├── components/            # Map, dialogs + shadcn/ui
│   └── lib/                   # auth, firebase, localFirestore
├── dist/
│   ├── public/                # Frontend buildado
│   └── admin/                 # Painel admin CBERS
├── banco_de_dados/            # Conhecimento florestal (29 .md)
├── docs/WMS_CBERS.md          # Documentação WMS/CBERS
└── firebase.json
```

---

## Módulos do Backend

### `index.ts` (Servidor Principal)
Roteador central que monta todos os endpoints:
- Chat streaming com LLMs Groq (POST /api/chat)
- Proxy WMS SEMA-MT com cache de capabilities
- Upload de arquivos (Cloudinary para imagens, storage local para PDFs)
- Métricas do servidor (CPU, RAM, disco, temperatura)
- Health check, keep-alive, rotas CRUD de storage

### `simcar-clip.ts` (Recorte SIMCAR)
**Maior módulo (~9.920 linhas).** Realiza o recorte de camadas do SIMCAR/SEMA-MT:

1. **Recorte WFS:** Busca feições via WFS SEMA-MT usando CQL `INTERSECTS`
2. **Shapefile local:** Fallback para shapes na pasta `SIMCAR_LOCAL_SHAPES_ROOT`
3. **Geração de shapefiles:** .shp/.shx/.dbf no template "Arquivo Modelo.zip"
4. **Análise Gemini:** Visão computacional do recorte SIMCAR
5. **Análise AUAS:** Áreas de Uso Alternativo do Solo
6. **Relatórios:** XLSX quantitativo + PDF

**Geometrias suportadas no recorte:**
- **Polygon/MultiPolygon** — interseção via `turfIntersect`
- **Point/MultiPoint** (ex: NASCENTE) — teste de contenção via **ray-casting**, mantido como Point (ShapeType 1)
- MultiPolygons são corretamente convertidos em **múltiplos registros** no shapefile (não achatados como buracos)

### `cbers-wpm.ts` (CBERS-4A WPM)
Pipeline completo de download/processamento de imagens CBERS-4A WPM via STAC INPE:
1. Busca cenas por órbita/ponto/data
2. Download de bandas (BAND3, BAND4, BAND2, BAND0)
3. Fusão PAN (pansharpening) via GDAL → GeoTIFF C342_PAN
4. Publicação automática no GeoServer local
5. Cópia para acervo permanente no HD Backup

### `knowledge-base.ts` (RAG)
Sistema de busca semântica na base de conhecimento em Markdown:
- Carregamento seletivo por tópico (otimização de tokens)
- Similaridade por correspondência de palavras-chave

### `shapefile-writer.ts`
Escrita de shapefiles binários:
- **ShapeType 5 (Polygon)** — camadas poligonais (APP, RL, rios, vegetação)
- **ShapeType 1 (Point)** — camadas de pontos (NASCENTE)
- Geração de .dbf (dBASE III), .shx (index)
- **Validação de topologia ESRI:** anéis exteriores CW, buracos CCW
- **MultiPolygon → múltiplos registros** (1 registro por polígono)

### `billing.ts` (Faturamento)
Sistema interno de cobrança:
- Reserva de créditos por requisição
- Cobrança por tokens (LLM) e armazenamento (Cloudinary)
- Estorno automático em caso de erro
- Histórico por sessão

---

## Correções Recentes

### v1 — NASCENTE como pontos (2026-05-09)
**Problema:** A camada NASCENTE no WFS SEMA-MT é de pontos (Point/MultiPoint). O `toPolygonOrMultiFeature` retornava `null` para pontos, fazendo com que fossem ignorados no recorte.

**Correção:**
- Criada função `isPointOrMultiPoint` e `pointInsidePolygon` (ray-casting)
- `clipFeaturesToPolygon` agora aceita geometries `Point` e `MultiPoint`
- Novas funções `buildPointShpAndShx` e tipo `PointShpRecord` para gerar shapefiles ShapeType 1
- Pipeline separa polígonos (`clippedLayers`) de pontos (`clippedPointLayers`)

**Arquivos:** `backend/shapefile-writer.ts`, `backend/simcar-clip.ts`

### v2 — MultiPolygon tratado como buracos (2026-05-09)
**Problema:** `geojsonToShpRings` achatava MultiPolygons num array único de rings, tratando o segundo polígono como buraco do primeiro. O shapefile resultante tinha topologia inválida — no ArcMap operações como Union desapareciam com os shapes.

**Correção:**
- Nova função `geojsonToPolyRecords` — retorna um array de `{ rings }` por polígono
- Função `enforceShapefileRingOrientation` — garante orientação ESRI (exterior CW, buracos CCW)
- Pipeline usa `geojsonToPolyRecords` em vez de `geojsonToShpRings` nas camadas recortadas por WFS

**Arquivos:** `backend/shapefile-writer.ts`, `backend/simcar-clip.ts`

### v3 — AIR/ATP com múltiplos polígonos no SHP de propriedade (2026-05-15)
**Problema:** No fluxo de cópia direta (`AIR` e `ATP`), um shapefile de propriedade com mais de um polígono podia gerar saída incompleta/corrompida, porque o caminho antigo convertia a geometria do imóvel para rings em vez de registros shapefile separados.

**Correção:**
- Nova função `geojsonToShpRecords` em `backend/shapefile-writer.ts`
- `AIR` e `ATP` agora geram **um registro shapefile por polígono** quando a entrada é `MultiPolygon`
- O campo `IDENTIFIC` da `AIR` é preenchido com o mesmo valor em todos os registros gerados
- `ATP` não mistura polígonos independentes no mesmo registro, evitando corrupção de multipart/rings em GIS
- Testes de regressão em `backend/shapefile-writer.test.ts`

**Documentação:** [`docs/SIMCAR_MULTIPOLYGON_AIR_ATP.md`](docs/SIMCAR_MULTIPOLYGON_AIR_ATP.md)

**Arquivos:** `backend/shapefile-writer.ts`, `backend/simcar-clip.ts`, `backend/shapefile-writer.test.ts`

---

## Pipeline SIMCAR Clip

```
1. Upload ZIP (.shp + .dbf + .prj) do imóvel
       │
       ▼
2. Parse → polígono unificado em EPSG:4674
       │
       ▼
3. GetCapabilities WFS SEMA-MT → descobre camadas
       │
       ▼
4. Para cada camada (TEMPLATE_LAYERS):
       ├── "AIR"/"ATP" → cópia direta do imóvel
       ├── WFS match → fetch + clipFeaturesToPolygon():
       │   ├── Polygon → turfIntersect
       │   ├── Point → ray-casting, mantido como Point
       │   └── Outros → ignorados
       └── Sem WFS → tenta shape local (simcar_digital)
       │
       ▼
5. ZIP final:
   ├── .shp (ShapeType 5 Polygon ou ShapeType 1 Point)
   ├── .shx + .dbf + .prj
   ├── QUANTITATIVOS.xlsx
   └── Demais arquivos do template
```

### Camadas Recortadas (TEMPLATE_LAYERS)

```typescript
const TEMPLATE_LAYERS = [
  "AIR", "ATP",                               // Cópia direta do imóvel
  "AREA_CONSOLIDADA", "AREA_USO_RESTRITO",
  "INTERESSE_SOCIAL", "UTILIDADE_PUBLICA",
  "RIO_ATE_10", "RIO_10_A_50", "RIO_50_A_200",
  "RIO_200_A_600", "RIO_ACIMA_600",
  "NASCENTE",                                  // Shape de pontos (ShapeType 1)
  "RESERVATORIO_ARTIFICIAL", "LAGOA_NATURAL",
  "TIPOLOGIA_VEGETAL", "MANGUEZAL", "RESTINGA", "VEREDA",
  "AREA_ALTITUDE_1800", "AREA_DECLIVIDADE",
  "AREA_TOPO_MORRO", "BORDA_CHAPADA",
  "ARL", "ARLREM", "AUAS", "AURD", "AVN", "AREA_UMIDA",
];
```

**⚠️ NASCENTE:** Camada de **pontos** no WFS SEMA-MT. Recorte por ray-casting, escrita como ShapeType 1.

**⚠️ MultiPolygons:** Cada polígono vira um registro separado no shapefile (registro multi-part apenas para buracos reais). Orientação corrigida automaticamente (ESRI spec). Para `AIR`/`ATP`, isso também vale para o shapefile de propriedade importado: se a entrada tiver múltiplos polígonos, todos são preservados como registros separados; em `AIR`, o mesmo `IDENTIFIC` informado pelo usuário é repetido em todos. Detalhes em [`docs/SIMCAR_MULTIPOLYGON_AIR_ATP.md`](docs/SIMCAR_MULTIPOLYGON_AIR_ATP.md).

---

## Vértices Próximas

Módulo para localizar pares de vértices muito próximos em shapefiles poligonais do SIMCAR.

**Regra crítica:** compara somente dentro do mesmo grupo `camada + feição + parte + anel`. Não compara feições diferentes, partes diferentes, anéis diferentes ou polígonos que apenas se encostam. O ponto final repetido do anel é ignorado como fechamento natural.

**Fluxo:** aba **Vértices Próximas** → upload ZIP → seleção/configuração de camadas → processamento assíncrono → tabela de resultados → download do ZIP.

**Saídas:** `pontos_vertices_proximas.shp`, `vertices_pares.shp` opcional, `resumo_vertices.csv` opcional e `relatorio_vertices.txt` opcional.

**Documentação:** [`docs/VERTICES_PROXIMAS.md`](docs/VERTICES_PROXIMAS.md)

**Arquivos:** `backend/vertices-proximas.ts`, `backend/vertices-proximas.test.ts`, `client/src/pages/Dashboard.tsx`

---

## CBERS e WMS Local

Documentação detalhada: [`docs/WMS_CBERS.md`](docs/WMS_CBERS.md).

**Resumo:**
- **Acervo:** `/media/server/HD Backup/RASTER/CBERS_4A/<orbita_ponto>/<ano>/`
- **GeoServer:** `localhost:8081`, workspace `cbers`
- **WMS Público:** `https://wms.cursar.space` (Cloudflare Tunnel → proxy :8082 → GeoServer :8081)
- **STAC INPE:** `https://data.inpe.br/bdc/stac/v1` (collection `CB4A-WPM-L4-DN-1`)
- **Painel Admin:** `https://geoforest-admin.web.app`
- **Índice global:** Armazenado em JSON em `Banco_de_dados/GeoForest/cbers_archive/images/`

---

## Banco de Conhecimento

8 módulos, **29 arquivos** em `banco_de_dados/`:

| Módulo | Tópicos |
|--------|---------|
| 01 - Estrutura Institucional | SEMA-MT, SIMCAR, SLAPR, licenciamento |
| 02 - Legislação Federal | Código Florestal, SNUC, crimes ambientais |
| 03 - Legislação Estadual | Código Ambiental MT, LC 592/2017, INs |
| 04 - Engenharia Florestal | CAR, APP, RL, PMFS, PRAD, supressão |
| 05 - Matrizes de Decisão | Fluxogramas, checklists, matriz de risco |
| 06 - Sensoriamento Remoto | CBERS, Landsat, Sentinel, índices |
| 07 - Geoprocessamento | Shapefiles, projeções, precisão |
| 08 - Termos de Referência SEMA | TR 2024 — docs, geoprocessamento, manejo |

Sistema **RAG** próprio: carrega apenas documentos relevantes para otimizar tokens.

---

## API - Endpoints

### Chat
| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/api/chat` | Chat streaming com IA |
| GET | `/api/models` | Lista modelos disponíveis |

### Mapa e WFS
| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/map/capabilities` | Camadas WMS disponíveis |
| POST | `/api/map/snapshot` | Gera snapshot de mapa |
| POST | `/api/geometry/bbox` | Extrai bbox de .kml/.shp |

### SIMCAR Clip
| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/api/simcar/clip` | Recorte SIMCAR (SSE) |
| GET | `/api/simcar/clip/download/:jobId` | Download ZIP |
| POST | `/api/simcar/clip/analyze` | Análise IA (SSE) |
| POST | `/api/simcar/clip/analyze-auas` | Análise AUAS (SSE) |
| POST | `/api/simcar/clip/import-vectorized` | Import ZIP pré-vetorizado |
| GET | `/api/simcar/gemini/config` | Config Gemini (+ probe) |

### Vértices Próximas
| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/api/vertices/upload` | Upload ZIP e listagem de camadas poligonais |
| POST | `/api/vertices/process` | Processamento assíncrono de vértices próximas |
| GET | `/api/vertices/jobs/:jobId/events` | Progresso via SSE |
| GET | `/api/vertices/jobs/:jobId/status` | Status do job |
| GET | `/api/vertices/download/:jobId` | Download ZIP final |
| DELETE | `/api/vertices/jobs/:jobId` | Cancela/remove job |

### CBERS
| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/api/cbers/search` | Busca cenas CBERS |
| POST | `/api/cbers/download` | Download e processamento |
| GET | `/api/cbers/images` | Imagens da conta |
| DELETE | `/api/cbers/images/:id` | Remove da conta |

### CBERS Archive (Admin)
| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/admin/cbers-storage/summary` | Resumo acervo |
| GET | `/api/admin/cbers-storage/users/:uid/images` | Imagens por user |
| DELETE | `/api/admin/cbers-storage/images/:imageId` | Exclusão definitiva |

### Upload e Storage
| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/api/upload-image` | Upload imagem (Cloudinary) |
| POST | `/api/upload-file` | Upload PDF |
| GET | `/api/file-proxy` | Proxy de arquivos |
| GET | `/api/storage/*` | Leitura de documentos |

### Sistema
| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/health` | Health check |
| GET | `/api/runtime/version` | Versão |
| GET | `/api/server/metrics` | Métricas da máquina |

---

## Deploy

### Frontend (Firebase Hosting)
```bash
firebase deploy --only hosting --project ia-florestal
```

### Backend (local — systemd)
```bash
systemctl --user restart geoforest-backend.service
```

### Desenvolvimento
```bash
# Frontend (Vite dev server)
npm run dev

# Backend (tsx, reload manual)
npm run dev:server
```

### Build completo
```bash
npm run build
# Gera: dist/public/, dist/admin/, dist/index.js
```

---

## Manutenção

### Verificar status
```bash
# API
curl -sS https://geoforest-api.cursar.space/api/health

# WMS
curl -sS "https://wms.cursar.space/geoserver/cbers/wms?service=WMS&version=1.3.0&request=GetCapabilities"

# App
curl -fsSI https://ia-florestal.web.app
```

### Reiniciar serviços
```bash
systemctl --user restart geoforest-backend.service
systemctl --user restart geoserver-wms.service
systemctl --user restart geoserver-wms-public-proxy.service
```

### Logs
```bash
journalctl --user -u geoforest-backend.service -n 50 -f
```

---

## Variáveis de Ambiente

| Variável | Obrig. | Descrição |
|----------|--------|-----------|
| `GROQ_API_KEY` | ✅ | API key Groq (LLMs) |
| `CLOUDINARY_API_KEY` | ✅ | Cloudinary |
| `CLOUDINARY_API_SECRET` | ✅ | Cloudinary |
| `GEMINI_API_KEY` | ⚠️ | Gemini para análise SIMCAR |
| `SEMA_WMS_BASE_URL` | ❌ | WMS SEMA-MT |
| `SEMA_WMS_AUTHKEY` | ❌ | Auth key WMS SEMA |
| `SIMCAR_REQUIRE_GEMINI` | ❌ | Falha sem Gemini se true |
| `SIMCAR_LOCAL_SHAPES_ROOT` | ❌ | Pasta shapes locais SIMCAR |
| `CLOUDINARY_FOLDER` | ❌ | Pasta Cloudinary |
| `GEMINI_VISION_MODELS` | ❌ | Modelos visão (separados por `,`) |
| `GEMINI_TEXT_SYNTHESIS_MODELS` | ❌ | Modelos síntese textual |
| `GEMINI_IMAGE_SHARE` | ❌ | Proporção imagens (0.55-0.95) |

---

## Documentação Adicional

- [`docs/WMS_CBERS.md`](docs/WMS_CBERS.md) — WMS local, CBERS, acervo permanente
- [`README_PROJETO.md`](README_PROJETO.md) — Documentação original (frontend)
- [`FIREBASE_SETUP.md`](FIREBASE_SETUP.md) — Configuração Firebase
- `banco_de_dados/INDICE.md` — Índice completo da base de conhecimento
- `.agents/` — Prompts de agentes (WMS, SIMCAR, CBERS)
