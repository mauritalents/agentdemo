# Agent conversationnel, démo (clé API fournie par l'utilisateur)

Application web statique : chaque utilisateur choisit son fournisseur LLM (Groq, OpenAI, Mistral,
OpenRouter, Gemini, Together, Anthropic ou autre API compatible OpenAI) et saisit sa propre clé API.
Les appels partent directement du navigateur vers le fournisseur. Aucun serveur intermédiaire.

## Structure

    public/index.html   interface
    public/style.css    style
    public/app.js       logique (appels API, streaming, stockage de la clé)
    firebase.json       configuration Firebase Hosting + en têtes de sécurité
    .firebaserc         identifiant du projet Firebase (à remplacer)

## Tester en local

    cd public
    python3 -m http.server 8080
    # puis ouvrir http://localhost:8080

## Déployer sur Firebase Hosting

    npm install -g firebase-tools
    firebase login
    # éditer .firebaserc avec l'ID de votre projet
    firebase deploy --only hosting

## Sécurité

* Aucune clé n'est écrite dans le code ni dans le dépôt.
* La clé est stockée dans sessionStorage (effacée à la fermeture de l'onglet),
  ou dans localStorage si l'utilisateur coche « Mémoriser ».
* Conseil pour les démos : utiliser des clés dédiées, puis les révoquer après la séance.
