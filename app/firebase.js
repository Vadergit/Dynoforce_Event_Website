import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const fallbackConfig = {
  apiKey: "AIzaSyCPSI670w5BFJcts_7uHDR87zbsFwFdiI0",
  authDomain: "dynoforce.firebaseapp.com",
  projectId: "dynoforce",
  storageBucket: "dynoforce.firebasestorage.app",
  messagingSenderId: "609566770862",
  appId: "1:609566770862:web:8e833f77dbdb95c611cf3f",
};

const envConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const config = envConfig.projectId ? envConfig : fallbackConfig;
const app = initializeApp(config);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
