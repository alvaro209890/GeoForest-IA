# 🌲 GeoForest IA - Aplicação Web

Aplicação web moderna para autenticação e gestão de usuários especializados em Engenharia Florestal, com integração completa Firebase Auth, Firestore e tema escuro premium.

## ✨ Características Principais

### Design Premium
- **Glassmorphism**: Cartões semi-transparentes com backdrop blur elegante
- **Paleta de Cores Profissional**: Verde Floresta Profundo, Musgo Claro, Ouro Terroso
- **Tipografia Elegante**: Playfair Display (headings) + Inter (body)
- **Background Artístico**: Imagem de floresta densa com elementos tecnológicos integrados
- **Animações Fluidas**: Transições suaves e micro-interactions naturais

### Funcionalidades de Autenticação
- ✅ Cadastro completo com validação
- ✅ Login seguro com Firebase Auth
- ✅ Logout com confirmação
- ✅ Recuperação de senha (pronto para implementar)
- ✅ Tratamento de erros amigável

### Gerenciamento de Dados
- ✅ Armazenamento seguro no Firestore
- ✅ Campos de usuário: Nome, Email, CREA, Área de Atuação
- ✅ Timestamp automático de criação
- ✅ Proteção de dados com regras de segurança

### Interface Responsiva
- ✅ Mobile-first design
- ✅ Suporte para tablets e desktops
- ✅ Temas claro/escuro (pronto para implementar)
- ✅ Acessibilidade WCAG

## 🏗️ Arquitetura do Projeto

```
forest-eng-app/
├── client/
│   ├── public/              # Arquivos estáticos
│   ├── src/
│   │   ├── components/      # Componentes reutilizáveis (shadcn/ui)
│   │   ├── contexts/        # React Contexts (Tema, etc)
│   │   ├── hooks/           # Custom Hooks
│   │   ├── lib/
│   │   │   ├── firebase.ts  # Configuração Firebase ⚙️
│   │   │   └── auth.ts      # Funções de autenticação
│   │   ├── pages/
│   │   │   ├── Auth.tsx     # Login & Cadastro
│   │   │   ├── Dashboard.tsx # Dashboard do usuário
│   │   │   └── NotFound.tsx
│   │   ├── App.tsx          # Roteamento principal
│   │   ├── main.tsx         # Entry point
│   │   └── index.css        # Estilos globais & temas
│   └── index.html
├── FIREBASE_SETUP.md        # Guia de configuração Firebase 📖
├── README_PROJETO.md        # Este arquivo
└── package.json
```

## 🚀 Quick Start

### 1. Configurar Firebase
Siga o guia completo em `FIREBASE_SETUP.md`

### 2. Instalar Dependências
```bash
cd forest-eng-app
pnpm install
```

### 3. Iniciar Desenvolvimento
```bash
pnpm dev
```

### 4. Acessar Aplicação
```
http://localhost:3000
```

## 📱 Telas Implementadas

### Tela de Login
- Email e senha
- Validação de formulário
- Toggle de visibilidade de senha
- Link para cadastro
- Tratamento de erros

### Tela de Cadastro
- Nome Completo
- Email com validação
- Registro CREA
- Seleção de Área de Atuação
- Senha com confirmação
- Validação completa de formulário

### Dashboard
- Exibição de perfil do usuário
- Informações do Firestore
- Cards de estatísticas
- Seção de funcionalidades
- Botão de logout

## 🔐 Segurança

### Firebase Auth
- Senhas com hash criptográfico
- Validação de email
- Proteção contra força bruta
- Sessões seguras

### Firestore Rules
```firestore
- Usuários podem ler/escrever apenas seus próprios dados
- Dados públicos são apenas leitura
- Acesso restrito a usuários autenticados
```

## 🎨 Customização

### Alterar Paleta de Cores
Edite `client/src/index.css`:
```css
:root {
  --primary: oklch(0.35 0.12 145);        /* Verde Floresta */
  --secondary: oklch(0.42 0.08 145);      /* Musgo */
  --accent: oklch(0.65 0.15 60);          /* Ouro Terroso */
}
```

### Alterar Tipografia
Edite `client/index.html`:
```html
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
```

### Alterar Background
Edite `client/src/pages/Auth.tsx`:
```tsx
backgroundImage: 'url(https://sua-url-aqui.jpg)',
```

## 📦 Dependências Principais

- **React 19**: Framework UI
- **Tailwind CSS 4**: Estilização
- **shadcn/ui**: Componentes acessíveis
- **Firebase**: Auth + Firestore
- **Wouter**: Roteamento leve
- **Sonner**: Toast notifications
- **Lucide React**: Ícones
- **Framer Motion**: Animações

## 🔧 Variáveis de Ambiente

Nenhuma variável de ambiente é necessária para o desenvolvimento local. As credenciais Firebase são configuradas diretamente em `client/src/lib/firebase.ts`.

Para produção, considere usar variáveis de ambiente:
```bash
VITE_FIREBASE_API_KEY=xxx
VITE_FIREBASE_AUTH_DOMAIN=xxx
VITE_FIREBASE_PROJECT_ID=xxx
```

## 📚 Estrutura de Dados Firestore

### Collection: `users`
```json
{
  "uid": "user123",
  "email": "usuario@example.com",
  "fullName": "João Silva",
  "creaNumber": "12345/D-SP",
  "specialization": "manejo",
  "createdAt": "2026-02-16T11:45:00Z"
}
```

## 🧪 Testando a Aplicação

### Teste de Cadastro
1. Acesse http://localhost:3000
2. Clique em "Cadastro"
3. Preencha todos os campos
4. Clique em "Cadastrar"
5. Verifique se foi redirecionado para `/dashboard`
6. Verifique dados no Firebase Console

### Teste de Login
1. Faça logout
2. Retorne à página de login
3. Insira email e senha cadastrados
4. Clique em "Entrar"
5. Verifique se foi redirecionado para `/dashboard`

### Teste de Validação
1. Tente cadastrar com email inválido
2. Tente cadastrar com senhas diferentes
3. Tente fazer login com email não registrado
4. Verifique mensagens de erro

## 🚢 Deploy

### Opção 1: Vercel
```bash
vercel deploy
```

### Opção 2: Netlify
```bash
netlify deploy --prod --dir=dist
```

### Opção 3: Firebase Hosting
```bash
firebase deploy
```

## 📖 Documentação Adicional

- [Firebase Documentation](https://firebase.google.com/docs)
- [React Documentation](https://react.dev)
- [Tailwind CSS](https://tailwindcss.com)
- [shadcn/ui](https://ui.shadcn.com)

## 🐛 Troubleshooting

### Erro: "Cannot find module 'firebase'"
```bash
pnpm install firebase
```

### Erro: "Firebase configuration is invalid"
Verifique se as credenciais em `client/src/lib/firebase.ts` estão corretas

### Erro: "Firestore permission denied"
Verifique as regras de segurança no Firebase Console

### Aplicação não carrega no mobile
Verifique se o servidor está acessível: `pnpm dev -- --host`

## 📞 Suporte

Para problemas ou dúvidas:
1. Verifique o console do navegador (F12)
2. Verifique os logs do servidor
3. Consulte a documentação do Firebase
4. Abra uma issue no repositório

## 📄 Licença

© 2026 GeoForest IA. Todos os direitos reservados.

---

**Desenvolvido com ❤️ usando React, Tailwind CSS, Firebase e Tema Escuro Premium**
