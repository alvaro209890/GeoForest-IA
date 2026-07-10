# CHANGELOG 2026-07-09 — Modernização Mobile + UI dos Recibos

## Resumo

Duas grandes melhorias implementadas no GeoForest-IA:
1. **Modernização dos seletores da aba de Recibos** — UI mais moderna, animada e polida
2. **Responsividade mobile completa** — Todo o frontend adaptado para celulares (375px+)

---

## 1. Modernização dos Seletores de Recibos

### ReceiptsHub.tsx (Hub de abas)
- **Indicador deslizante animado** que acompanha a tab ativa com `cubic-bezier(0.4,0,0.2,1)`
- Ícones com efeito `scale-110` na tab ativa
- Badge de subtítulo dinâmico com glow (verde/azul)
- Glass morphism refinado com `backdrop-blur` e `shadow-[inset_...]`
- Full-width no mobile, `w-fit` no desktop
- Labels reduzidas no mobile (`"Recibos"`, `"APF"` em vez do nome completo)

### ApfReceiptDownloader.tsx (APF Rural)
- **`<select>` nativo substituído** por **segmented control** animado (`Estadual | Federal`)
  - Indicador deslizante com transição suave
  - Cores azul (temática APF) com borda e glow
- **Inputs com ícones integrados**: User para CPF, Shield para tipo CAR
- Botão X para limpar cada campo individualmente
- **Animação de collapse/expand** nos filtros avançados com `grid-rows-[0fr]` → `grid-rows-[1fr]`
- Botão toggle: "Mostrar/Ocultar filtros avançados" mais descritivo
- **Empty state** contextual quando nenhum filtro ativo
- Botões de download com `justify-center` e `min-h-[44px]` (touch target Apple)

### SimcarReceiptDownloader.tsx (Recibos SIMCAR)
- Layout de busca unificado CPF `ou` CAR (igual ao APF)
- **Dicas de busca expansíveis** com formato estadual vs federal
- **Seleção de itens com radio indicator**:
  - Círculo com check animado no canto superior direito de cada card
  - Card selecionado com glow verde (`shadow-[0_0_20px_rgba(16,185,129,0.06)]`)
  - Badge "selecionado" com animação `animate-fade-in-up`
- **Download rápido inline** em cada card (antes só tinha no cabeçalho)
- Header card padronizado com gradiente (igual APF)
- Estados de empty/loading/error unificados visualmente

---

## 2. Responsividade Mobile

### index.css — Novos utilitários CSS
- **Touch targets**: `min-height: 44px` / `min-width: 44px` em inputs, botões e selects (padrão Apple HIG)
- **Safe area insets**: classes `safe-top`, `safe-bottom`, `safe-left`, `safe-right` para dispositivos com notch
- **Horizontal scroll tabs**: classe `scroll-tabs` com `scroll-snap`, sem scrollbar visível, touch otimizado
- **Animações reutilizáveis**: `animate-fade-in-up`, `animate-slide-in-right`
- **Stagger children**: `.stagger-fade-in > *` com delays progressivos para listas
- **Mobile typography**: redução de h1-h6 em telas < 767px
- **Custom scrollbar**: 4px fina com track transparente
- **`-webkit-text-size-adjust: 100%`** e **`overscroll-behavior: none`** no body

### Dashboard.tsx — Ajustes mobile
- **Header**: padding responsivo (`px-3 sm:px-4 lg:px-6`), botão menu com touch target 44px, `safe-top`
- **Tabs (5 abas)**: `flex` com scroll horizontal no mobile, `grid grid-cols-5` no desktop (`scroll-tabs`)
- **Sidebar**: padding reduzido no mobile (`px-1 sm:px-3`)
- **Conteúdo**: padding responsivo em 3 níveis (`px-2 sm:px-4 lg:px-6`, `py-3 sm:py-6 lg:py-8`)
- **Seções**: padding interno responsivo (`p-3 sm:p-5 lg:p-6`)

### Busca nos Recibos (APF e SIMCAR) — Mobile
- **Layout empilhado**: inputs em coluna no mobile (`flex-col`), lado a lado no desktop (`sm:flex-row`)
- **Botões full-width**: `flex-1 sm:flex-none` para Buscar e Limpar ocuparem 50% cada no mobile
- **Separador "ou"** centralizado com padding vertical no mobile
- Todos inputs com `min-h-[44px]` (touch target)
- Botões de ação nos cards: coluna no mobile (`flex-col sm:flex-row`)

---

## 3. Arquivos Modificados

| Arquivo | Mudanças |
|---------|----------|
| `client/src/index.css` | +100 linhas: touch targets, safe areas, scroll-tabs, animações, mobile typography |
| `client/src/components/ReceiptsHub.tsx` | Pill switcher animado, full-width mobile, labels reduzidas |
| `client/src/components/ApfReceiptDownloader.tsx` | Segmented control, inputs com ícones, animação collapse, mobile layout |
| `client/src/components/SimcarReceiptDownloader.tsx` | Radio indicator nos cards, dicas expansíveis, mobile layout, header padronizado |
| `client/src/pages/Dashboard.tsx` | scroll-tabs, padding responsivo, safe-top header, touch target menu |

---

## 4. Verificação

- ✅ `tsc --noEmit`: **0 erros**
- ✅ `vite build`: **1691 módulos**, 4.96s, zero warnings
- ✅ CSS: 243.46 kB (gzip 32.80 kB)
- ✅ Dashboard chunk: 411.56 kB (gzip 87.41 kB)

---

## 5. Testar no Celular

Para testar em dispositivo real:
1. Acessar a URL de produção do GeoForest-IA
2. Abrir as abas "Recibos" → SIMCAR e APF
3. Verificar se os inputs empilham corretamente em telas < 640px
4. Verificar touch targets (mínimo 44px)
5. Verificar scroll horizontal das 5 abas principais em telas < 640px
6. Verificar safe area em iPhones com notch
