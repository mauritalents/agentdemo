// Initialise Firebase uniquement si firebase-config.js a été renseigné.
// Sans configuration valide, l'application fonctionne normalement sans Firebase.
const cfg = window.FIREBASE_CONFIG;
const SDK = 'https://www.gstatic.com/firebasejs/11.0.2';

function isConfigured(c) {
  return !!c && !!c.apiKey && !!c.projectId && !/REMPLACEZ/.test(c.apiKey + c.projectId + (c.appId || ''));
}

if (isConfigured(cfg)) {
  try {
    const { initializeApp } = await import(SDK + '/firebase-app.js');
    window.firebaseApp = initializeApp(cfg);
    console.info('[Firebase] connecté au projet', cfg.projectId);
    document.dispatchEvent(new CustomEvent('firebase-ready'));
  } catch (e) {
    console.warn('[Firebase] initialisation impossible :', e && e.message);
  }
} else {
  console.info('[Firebase] non configuré (renseignez public/firebase-config.js).');
}
