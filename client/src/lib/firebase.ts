/**
 * Firebase Configuration
 * 
 * Design Philosophy: Natureza Elevada com Tecnologia Integrada
 * Este arquivo centraliza toda a configuração do Firebase para autenticação e Firestore.
 * 
 * INSTRUÇÕES:
 * 1. Substitua os valores abaixo com suas credenciais do Firebase
 * 2. Você pode encontrar essas credenciais em: Firebase Console > Configurações do Projeto > Chave de API da Web
 */

import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyCMYw7MFB__E5FrSGi91fgimCyN-gZhlGU",
  authDomain: "ia-florestal.firebaseapp.com",
  projectId: "ia-florestal",
  storageBucket: "ia-florestal.firebasestorage.app",
  messagingSenderId: "884183347082",
  appId: "1:884183347082:web:249c275edc06b10df86273",
  measurementId: "G-9M7EVMC8BE"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firebase Authentication
export const auth = getAuth(app);

// Initialize Firestore Database
export const db = getFirestore(app);

export default app;
