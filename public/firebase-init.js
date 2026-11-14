// Initialise Firebase uniquement si firebase-config.js a été renseigné.
// Sans configuration valide, l'application fonctionne normalement sans Firebase.
// Auth et Firestore ne sont chargés que si l'utilisateur coche « Enregistrer mes échanges dans Firestore ».
const cfg = window.FIREBASE_CONFIG;
const SDK = 'https://www.gstatic.com/firebasejs/11.0.2';

function isConfigured(c) {
  return !!c && !!c.apiKey && !!c.projectId && !/REMPLACEZ/.test(c.apiKey + c.projectId + (c.appId || ''));
}

if (isConfigured(cfg)) {
  try {
    const { initializeApp } = await import(SDK + '/firebase-app.js');
    window.firebaseApp = initializeApp(cfg);

    let ctx = null;
    // Charge Auth + Firestore et ouvre une session anonyme (un identifiant par navigateur, sans compte à créer)
    async function ensure() {
      if (ctx) return ctx;
      const [authMod, fs] = await Promise.all([
        import(SDK + '/firebase-auth.js'),
        import(SDK + '/firebase-firestore.js')
      ]);
      const auth = authMod.initializeAuth(window.firebaseApp, {
        persistence: [authMod.indexedDBLocalPersistence, authMod.browserLocalPersistence]
      });
      await auth.authStateReady();
      if (!auth.currentUser) await authMod.signInAnonymously(auth);
      ctx = { auth: auth, db: fs.getFirestore(window.firebaseApp), fs: fs };
      return ctx;
    }

    window.FirebaseSave = {
      projectId: cfg.projectId,
      // Active l'enregistrement : échoue avec une erreur claire si Auth anonyme ou Firestore ne sont pas activés
      enable: async function () { await ensure(); return true; },
      // Enregistre un échange (question + réponse) dans users/{uid}/conversations/{convId}/messages
      saveExchange: async function (x) {
        const c = await ensure();
        const fs = c.fs;
        const uid = c.auth.currentUser.uid;
        const convRef = fs.doc(c.db, 'users', uid, 'conversations', x.convId);
        const msgs = fs.collection(convRef, 'messages');
        const t = Date.now();
        const batch = fs.writeBatch(c.db);
        batch.set(convRef, {
          provider: x.provider, model: x.model, startedAt: x.startedAt, updatedAt: fs.serverTimestamp()
        }, { merge: true });
        batch.set(fs.doc(msgs), { role: 'user', content: x.user, model: x.model, createdAt: fs.serverTimestamp(), idx: t });
        batch.set(fs.doc(msgs), { role: 'assistant', content: x.assistant, model: x.model, createdAt: fs.serverTimestamp(), idx: t + 1 });
        await batch.commit();
      }
    };

    console.info('[Firebase] connecté au projet', cfg.projectId);
    document.dispatchEvent(new CustomEvent('firebase-ready'));
  } catch (e) {
    console.warn('[Firebase] initialisation impossible :', e && e.message);
  }
} else {
  console.info('[Firebase] non configuré (renseignez public/firebase-config.js).');
}
