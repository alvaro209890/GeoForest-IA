# Configuração Firebase - Engenharia Florestal IA

## 📋 Pré-requisitos

- Conta Google
- Projeto criado no [Firebase Console](https://console.firebase.google.com/)

## 🔧 Passo a Passo de Configuração

### 1. Criar Projeto no Firebase Console

1. Acesse [Firebase Console](https://console.firebase.google.com/)
2. Clique em **"Criar projeto"**
3. Insira um nome para seu projeto (ex: `engenharia-florestal-ia`)
4. Selecione sua região
5. Clique em **"Criar projeto"**

### 2. Habilitar Firebase Authentication

1. No Firebase Console, vá para **Autenticação** (Authentication)
2. Clique em **"Começar"** (Get Started)
3. Selecione **"Email/Senha"** (Email/Password)
4. Ative a opção **"Email/Senha"**
5. Clique em **"Salvar"**

### 3. Criar Banco de Dados Firestore

1. No Firebase Console, vá para **Firestore Database**
2. Clique em **"Criar banco de dados"** (Create database)
3. Selecione **"Iniciar no modo de teste"** (Start in test mode)
4. Escolha a localização do seu banco de dados
5. Clique em **"Criar"**

### 4. Obter Credenciais Firebase

1. No Firebase Console, clique no ícone de engrenagem (⚙️) no canto superior esquerdo
2. Selecione **"Configurações do projeto"** (Project Settings)
3. Vá para a aba **"Seu aplicativo"** (Your apps)
4. Clique em **"Adicionar app"** → **"Web"** (Add app → Web)
5. Insira um nome para seu aplicativo (ex: `Engenharia Florestal Web`)
6. Clique em **"Registrar app"** (Register app)
7. Copie as credenciais exibidas (firebaseConfig)

### 5. Atualizar Arquivo de Configuração

1. Abra o arquivo `client/src/lib/firebase.ts`
2. Substitua os valores de placeholder pelas suas credenciais:

```typescript
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",                    // Copie aqui
  authDomain: "YOUR_AUTH_DOMAIN",            // Copie aqui
  projectId: "YOUR_PROJECT_ID",              // Copie aqui
  storageBucket: "YOUR_STORAGE_BUCKET",      // Copie aqui
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID", // Copie aqui
  appId: "YOUR_APP_ID"                       // Copie aqui
};
```

### 6. Configurar Regras de Segurança do Firestore

1. No Firebase Console, vá para **Firestore Database**
2. Clique na aba **"Regras"** (Rules)
3. Substitua o conteúdo pelas seguintes regras:

```firestore
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Permitir que usuários autenticados leiam e escrevam seus próprios documentos
    match /users/{userId} {
      allow read, write: if request.auth.uid == userId;
    }
    
    // Permitir que usuários autenticados leiam dados públicos
    match /public/{document=**} {
      allow read: if request.auth != null;
      allow write: if false;
    }
  }
}
```

4. Clique em **"Publicar"** (Publish)

## 🚀 Executar a Aplicação

```bash
# Instalar dependências (se ainda não fez)
pnpm install

# Iniciar servidor de desenvolvimento
pnpm dev

# Acessar a aplicação
# http://localhost:3000
```

## 📝 Funcionalidades Implementadas

### Autenticação
- ✅ Cadastro de novo usuário com validação
- ✅ Login com email e senha
- ✅ Logout
- ✅ Tratamento de erros específicos do Firebase

### Dados do Usuário (Firestore)
- ✅ Nome Completo
- ✅ E-mail
- ✅ Registro Profissional (CREA)
- ✅ Área de Atuação
- ✅ Data de Cadastro (ServerTimestamp)

### Interface
- ✅ Tela de Login com glassmorphism
- ✅ Tela de Cadastro com formulário completo
- ✅ Dashboard com informações do perfil
- ✅ Design responsivo e moderno
- ✅ Paleta de cores: Verde Floresta, Musgo, Ouro Terroso

## 🔐 Estrutura de Dados no Firestore

```
users/
  ├── {uid}/
  │   ├── uid: string
  │   ├── email: string
  │   ├── fullName: string
  │   ├── creaNumber: string
  │   ├── specialization: string
  │   └── createdAt: Timestamp
```

## 🛠️ Arquivos Principais

- `client/src/lib/firebase.ts` - Configuração Firebase
- `client/src/lib/auth.ts` - Funções de autenticação
- `client/src/pages/Auth.tsx` - Telas de Login e Cadastro
- `client/src/pages/Dashboard.tsx` - Dashboard do usuário
- `client/src/index.css` - Estilos e paleta de cores

## 📞 Suporte

Para mais informações sobre Firebase:
- [Documentação Firebase](https://firebase.google.com/docs)
- [Firebase Console](https://console.firebase.google.com/)

## 📄 Licença

© 2026 Engenharia Florestal IA. Todos os direitos reservados.
