// Configuration Firebase de l'application web.
// À copier depuis la console Firebase : Paramètres du projet > Général > Vos applications > Application Web > Configuration du SDK.
// Ces valeurs ne sont PAS des secrets : elles identifient votre projet. La sécurité repose sur les règles
// Firebase (Auth, Firestore...) et non sur le secret de ce fichier. Ne mettez jamais ici une clé API de LLM (Groq, etc.).
window.FIREBASE_CONFIG = {
  apiKey: "REMPLACEZ_PAR_VOTRE_API_KEY",
  authDomain: "REMPLACEZ.firebaseapp.com",
  projectId: "REMPLACEZ_PAR_VOTRE_ID_PROJET",
  storageBucket: "REMPLACEZ.firebasestorage.app",
  messagingSenderId: "REMPLACEZ",
  appId: "REMPLACEZ"
};
