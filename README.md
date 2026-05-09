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
│   ├── auas-analysis.ts       # Análise AUAS (1.648 linhas)
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

### `auas-analysis.ts` (Análise AUAS)
Pipeline de análise de Uso Alternativo do Solo:
- Visão Gemini para interpretação de imagens
- Síntese textual + geração de shapefiles e PDF

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
- Pipeline usa `geojsonToPolyRecords` em vez de `geojsonToShpRings`

**Arquivos:** `backend/shapefile-writer.ts`, `backend/simcar-clip.ts`

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

**⚠️ MultiPolygons:** Cada polígono vira um registro separado no shapefile (registro multi-part apenas para buracos reais). Orientação corrigida automaticamente (ESRI spec).

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
