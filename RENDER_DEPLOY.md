# Deploy no Render — Configuração Completa

## Tipo de serviço

**Web Service** (não Static Site).
O projeto é full-stack: o backend Express serve tanto a API quanto os arquivos estáticos do React após o build.

---

## Configurações do serviço (aba Settings)

| Campo | Valor |
|---|---|
| **Environment** | Node |
| **Build Command** | `pnpm install && pnpm run build` |
| **Start Command** | `pnpm run start` |
| **Node version** | `20` (ou superior) |
| **Root Directory** | *(deixar vazio — raiz do repo)* |
| **Health Check Path** | `/api/health` |

---

## Variáveis de Ambiente (Environment Variables)

### OBRIGATÓRIAS — sem essas o serviço não funciona

```
GROQ_API_KEY=sk-...
```
Chave da [Groq](https://console.groq.com). Usada em **todo** o chat e análises.

```
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...
```
Credenciais do [Cloudinary](https://cloudinary.com). O Cloud Name já está fixo no código como `da19dwpgk` — você não precisa setar, mas confirme que as keys pertencem a essa conta.

```
FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account","project_id":"ia-florestal",...}
```
JSON completo da service account do Firebase Admin SDK (aba **Service Accounts** no Firebase Console → "Gerar nova chave privada").
Cole o JSON inteiro como valor da variável — o Render aceita strings longas.
**Alternativa:** se o JSON tiver aspas que quebram, encode em base64 e use:
```
FIREBASE_SERVICE_ACCOUNT_BASE64=<base64 do JSON>
```

---

### ALTAMENTE RECOMENDADAS

```
GEMINI_API_KEY=AIza...
```
Chave da [Google AI Studio](https://aistudio.google.com/app/apikey).
**Obrigatória se `SIMCAR_REQUIRE_GEMINI=true`** (que é o padrão). Sem ela a análise SIMCAR falha.

```
KEEP_ALIVE_URL=https://geoforest-ia.onrender.com/api/health
```
Faz o backend pingar a si mesmo a cada 5 min para não dormir no plano gratuito.
Substitua pelo URL real do seu serviço no Render.

---

### OPCIONAIS (com defaults já funcionando)

```
# Cloudinary — pasta de destino (default: geoforest)
CLOUDINARY_FOLDER=geoforest

# Keep-alive — intervalo em ms (default: 300000 = 5 min)
KEEP_ALIVE_INTERVAL_MS=300000

# SEMA-MT — WFS/WMS de dados ambientais de MT
SEMA_WMS_BASE_URL=https://geo.sema.mt.gov.br/geoserver/ows
SEMA_WMS_AUTHKEY=541085de-9a2e-454e-bdba-eb3d57a2f492

# Gemini — configuração dos modelos (defaults já definidos no código)
GEMINI_API_BASE=https://generativelanguage.googleapis.com/v1beta
GEMINI_VISION_MODELS=gemini-2.5-flash,gemini-3-flash,gemini-3-pro
GEMINI_TEXT_SYNTHESIS_MODELS=gemini-3-pro,gemini-3-flash,gemini-2.5-pro
GEMINI_IMAGE_SHARE=0.75
SIMCAR_REQUIRE_GEMINI=true

# WFS — timeouts e paginação (defaults seguros)
WFS_TIMEOUT_MS=25000
SIGEF_WFS_TIMEOUT_MS=90000
WFS_PAGE_SIZE=2000
WFS_MAX_FEATURES_PER_LAYER=50000
```

---

### MÓDULO NOVO CAR (AUAS) — configurar para ativar

```
# PRODES — desmatamento INPE (default já aponta para Terrabrasilis)
PRODES_WFS_URL=https://terrabrasilis.dpi.inpe.br/geoserver/ows
PRODES_LAYER=prodes-legal-amz:yearly_deforestation
PRODES_YEAR_FIELD=year

# SFB (rios) — a camada de hidrografia já está dentro do WFS da SEMA
# Use o mesmo endpoint da SEMA e informe o nome da camada correta:
SFB_WFS_URL=https://geo.sema.mt.gov.br/geoserver/wfs
SFB_RIVER_LAYER=Geoportal:SFB_HIDRO_TRECHO_DRENAGEM
SFB_WFS_AUTHKEY=541085de-9a2e-454e-bdba-eb3d57a2f492
```

> Camada confirmada no GetCapabilities do GeoServer da SEMA. Outras camadas de hidrografia disponíveis no mesmo servidor: `Geoportal:SFB_HIDRO_CATEGORIZADA`, `Geoportal:SFB_HIDRO_APP_HIDRICA`, `Geoportal:SFB_HIDRO_MASSA_DAGUA`, `Geoportal:HID_CURSOS_DAGUA`.

---

## Checklist de deploy

- [ ] Criar Web Service no Render apontando para este repositório
- [ ] Setar branch: `main` (ou a branch de produção)
- [ ] Configurar **Build Command**: `pnpm install && pnpm run build`
- [ ] Configurar **Start Command**: `pnpm run start`
- [ ] Adicionar variável `GROQ_API_KEY`
- [ ] Adicionar variáveis `CLOUDINARY_API_KEY` e `CLOUDINARY_API_SECRET`
- [ ] Adicionar variável `FIREBASE_SERVICE_ACCOUNT_JSON` (ou BASE64)
- [ ] Adicionar variável `GEMINI_API_KEY`
- [ ] Após o primeiro deploy, pegar a URL gerada (ex: `https://geoforest-ia.onrender.com`)
- [ ] Adicionar `KEEP_ALIVE_URL=https://<sua-url>.onrender.com/api/health`
- [ ] Verificar `/api/health` retorna `200 OK`
- [ ] Verificar `/api/simcar/gemini/config?probe=1` para confirmar que o Gemini está respondendo

---

## Observações importantes

### Plano gratuito do Render
O serviço dorme após 15 min sem requisições. O `KEEP_ALIVE_URL` resolve isso, mas a primeira requisição após o sleep ainda pode demorar ~30 s.
Para produção real considere o plano **Starter** ($7/mês) que não dorme.

### SSE (Server-Sent Events)
O Render suporta SSE nativamente. As análises SIMCAR usam SSE — não precisa de configuração extra.

### Disco efêmero
O Render não tem disco persistente no plano gratuito. O `Arquivo Modelo.zip` precisa estar **commitado no repositório** (já está em `backend/../Arquivo Modelo.zip`). Não o adicione ao `.gitignore`.

### CORS
O backend já detecta automaticamente quando está rodando no Render (`process.env.RENDER === 'true'`). Não precisa setar CORS_ORIGINS manualmente, mas se tiver frontend em domínio próprio, adicione:
```
CORS_ORIGINS=https://seudominio.com
```

### Firebase Client (frontend)
As credenciais do Firebase no frontend (`client/src/lib/firebase.ts`) estão hardcoded — isso é normal para o Firebase Client SDK, que usa regras de segurança do Firestore/Auth para proteção, não o segredo da chave em si.
