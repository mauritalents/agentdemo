(function () {
  'use strict';

  // ---------- Fournisseurs ----------
  // type "openai" = API compatible OpenAI (/chat/completions).
  // "prefer" = modèles préférés dans l'ordre, utilisés pour le choix automatique.
  // Si aucun n'existe dans la liste réelle du fournisseur, le premier modèle de chat disponible est pris.
  var PROVIDERS = {
    groq:       { label: 'Groq',                type: 'openai',    base: 'https://api.groq.com/openai/v1',                          model: 'openai/gpt-oss-120b',      keyUrl: 'https://console.groq.com/keys',
                  prefer: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.6-27b', 'llama-3.3-70b-versatile', 'llama-3.1-8b-instant'] },
    openai:     { label: 'OpenAI',              type: 'openai',    base: 'https://api.openai.com/v1',                               model: 'gpt-4o-mini',              keyUrl: 'https://platform.openai.com/api-keys',
                  prefer: ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4o'] },
    mistral:    { label: 'Mistral',             type: 'openai',    base: 'https://api.mistral.ai/v1',                               model: 'mistral-small-latest',     keyUrl: 'https://console.mistral.ai/api-keys',
                  prefer: ['mistral-small-latest', 'mistral-medium-latest', 'mistral-large-latest'] },
    openrouter: { label: 'OpenRouter',          type: 'openai',    base: 'https://openrouter.ai/api/v1',                            model: 'openai/gpt-4o-mini',       keyUrl: 'https://openrouter.ai/keys',
                  prefer: ['openai/gpt-4o-mini', 'openai/gpt-oss-120b'] },
    gemini:     { label: 'Google Gemini',       type: 'openai',    base: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash',         keyUrl: 'https://aistudio.google.com/apikey',
                  prefer: ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro'] },
    together:   { label: 'Together AI',         type: 'openai',    base: 'https://api.together.xyz/v1',                             model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', keyUrl: 'https://api.together.ai/settings/api-keys',
                  prefer: ['meta-llama/Llama-3.3-70B-Instruct-Turbo'] },
    anthropic:  { label: 'Anthropic (Claude)',  type: 'anthropic', base: 'https://api.anthropic.com/v1',                            model: 'claude-sonnet-5-5',        keyUrl: 'https://console.anthropic.com/settings/keys',
                  prefer: ['claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-opus-5-5'] },
    custom:     { label: 'Autre (compatible OpenAI)', type: 'openai', base: '',                                                      model: '',                         keyUrl: '',
                  prefer: [] }
  };

  var DEFAULT_SYSTEM = "Tu es un assistant utile, clair et concis. Tu réponds en français sauf si l'utilisateur écrit dans une autre langue.";
  var STORE_KEY = 'agentdemo_config';

  // ---------- Éléments ----------
  var $ = function (id) { return document.getElementById(id); };
  var els = {
    setup: $('setup'), setupForm: $('setupForm'), provider: $('provider'),
    customBox: $('customBox'), customUrl: $('customUrl'), apiKey: $('apiKey'),
    keyLink: $('keyLink'), model: $('model'), modelList: $('modelList'),
    autoModel: $('autoModel'), loadModels: $('loadModels'), remember: $('remember'),
    setupError: $('setupError'), startBtn: $('startBtn'),
    chat: $('chat'), badge: $('badge'), modelSelect: $('modelSelect'),
    newChat: $('newChat'), logout: $('logout'),
    systemPrompt: $('systemPrompt'), messages: $('messages'), chatForm: $('chatForm'),
    input: $('input'), send: $('send'), stop: $('stop'),
    saveFirestore: $('saveFirestore'), saveStatus: $('saveStatus')
  };

  var config = null;          // { provider, customUrl, apiKey, model, auto }
  var availableModels = [];   // modèles de chat connus pour ce fournisseur
  var history = [];           // [{role, content}]
  var controller = null;      // AbortController de la requête en cours
  var convId = '';            // identifiant de la conversation courante (Firestore)
  var convStartedAt = '';
  var saving = false;         // true si l'utilisateur a activé l'enregistrement Firestore

  // ---------- Initialisation ----------
  Object.keys(PROVIDERS).forEach(function (k) {
    var o = document.createElement('option');
    o.value = k; o.textContent = PROVIDERS[k].label;
    els.provider.appendChild(o);
  });
  els.systemPrompt.value = DEFAULT_SYSTEM;
  onProviderChange();
  onAutoChange();

  refreshSaveBox();
  document.addEventListener('firebase-ready', refreshSaveBox);

  var saved = loadConfig();
  if (saved) { config = saved; startChat(); }

  // ---------- Stockage ----------
  function loadConfig() {
    try {
      var raw = sessionStorage.getItem(STORE_KEY) || localStorage.getItem(STORE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function saveConfig(cfg, persistent) {
    clearConfig();
    try { (persistent ? localStorage : sessionStorage).setItem(STORE_KEY, JSON.stringify(cfg)); } catch (e) {}
  }
  // Met à jour la config là où elle est déjà stockée (changement de modèle en cours de session)
  function persist() {
    try {
      var inLocal = !!localStorage.getItem(STORE_KEY);
      (inLocal ? localStorage : sessionStorage).setItem(STORE_KEY, JSON.stringify(config));
    } catch (e) {}
  }
  function clearConfig() {
    try { sessionStorage.removeItem(STORE_KEY); localStorage.removeItem(STORE_KEY); } catch (e) {}
  }

  // ---------- Choix automatique du modèle ----------
  function isChatModel(id) {
    return !/whisper|tts|guard|embed|orpheus|playai|transcri|moderation|safeguard|rerank|dall-e|image|audio|realtime|davinci|babbage/i.test(id);
  }

  function pickModel(cfg, ids, exclude) {
    exclude = exclude || [];
    var chat = ids.filter(isChatModel).filter(function (id) { return exclude.indexOf(id) === -1; });
    var prefer = PROVIDERS[cfg.provider].prefer || [];
    for (var i = 0; i < prefer.length; i++) {
      if (chat.indexOf(prefer[i]) !== -1) return prefer[i];
    }
    return chat[0] || '';
  }

  // ---------- Écran de configuration ----------
  function onProviderChange() {
    var p = PROVIDERS[els.provider.value];
    els.customBox.hidden = els.provider.value !== 'custom';
    if (p.keyUrl) { els.keyLink.href = p.keyUrl; els.keyLink.hidden = false; } else { els.keyLink.hidden = true; }
    els.model.value = els.autoModel.checked ? '' : p.model;
    els.modelList.innerHTML = '';
  }
  els.provider.addEventListener('change', onProviderChange);

  function onAutoChange() {
    var auto = els.autoModel.checked;
    els.model.disabled = auto;
    els.model.required = !auto;
    els.model.placeholder = auto ? 'Choisi automatiquement avec votre clé' : 'ex : openai/gpt-oss-120b';
    if (auto) els.model.value = '';
    else if (!els.model.value) els.model.value = PROVIDERS[els.provider.value].model;
  }
  els.autoModel.addEventListener('change', onAutoChange);

  function showSetupError(msg) {
    els.setupError.textContent = msg;
    els.setupError.hidden = !msg;
  }

  function currentBase(cfg) {
    var p = PROVIDERS[cfg.provider];
    var base = cfg.provider === 'custom' ? (cfg.customUrl || '') : p.base;
    return base.replace(/\/+$/, '');
  }

  function readForm() {
    return {
      provider: els.provider.value,
      customUrl: els.customUrl.value.trim(),
      apiKey: els.apiKey.value.trim(),
      model: els.model.value.trim(),
      auto: els.autoModel.checked
    };
  }

  function validate(cfg) {
    if (!cfg.apiKey) return 'Veuillez saisir votre clé API.';
    if (cfg.provider === 'custom' && !/^https?:\/\//i.test(cfg.customUrl)) return "L'URL de base doit commencer par https://";
    return '';
  }

  els.loadModels.addEventListener('click', function () {
    var cfg = readForm();
    var err = validate(cfg);
    if (err) { showSetupError(err); return; }
    showSetupError('');
    els.loadModels.disabled = true;
    els.loadModels.textContent = 'Chargement…';
    fetchModels(cfg).then(function (ids) {
      els.modelList.innerHTML = '';
      ids.filter(isChatModel).forEach(function (id) {
        var o = document.createElement('option'); o.value = id; els.modelList.appendChild(o);
      });
      var best = pickModel(cfg, ids);
      if (!ids.length) {
        showSetupError('Aucun modèle renvoyé. Saisissez le nom du modèle à la main.');
      } else if (els.autoModel.checked) {
        showSetupError('');
        els.model.placeholder = 'Automatique : ' + best;
      } else {
        showSetupError('');
        els.model.focus();
      }
    }).catch(function (e) {
      showSetupError(explainError(e));
    }).then(function () {
      els.loadModels.disabled = false;
      els.loadModels.textContent = 'Charger la liste';
    });
  });

  els.setupForm.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var cfg = readForm();
    var err = validate(cfg);
    if (!cfg.auto && !cfg.model) err = err || 'Veuillez indiquer un modèle, ou cochez le choix automatique.';
    if (err) { showSetupError(err); return; }
    showSetupError('');

    var persistent = els.remember.checked;

    if (!cfg.auto) {
      config = cfg;
      availableModels = [];
      saveConfig(cfg, persistent);
      els.apiKey.value = '';
      startChat();
      return;
    }

    // Mode automatique : on interroge le fournisseur et on choisit le meilleur modèle disponible
    els.startBtn.disabled = true;
    els.startBtn.textContent = 'Recherche du meilleur modèle…';
    fetchModels(cfg).then(function (ids) {
      var m = pickModel(cfg, ids);
      if (!m) throw new Error('Aucun modèle de chat trouvé pour cette clé. Décochez le choix automatique et saisissez un modèle.');
      cfg.model = m;
      availableModels = ids.filter(isChatModel);
      config = cfg;
      saveConfig(cfg, persistent);
      els.apiKey.value = '';
      startChat();
    }).catch(function (e) {
      showSetupError(explainError(e));
    }).then(function () {
      els.startBtn.disabled = false;
      els.startBtn.textContent = 'Démarrer la conversation';
    });
  });

  // ---------- Appels API ----------
  function authHeaders(cfg) {
    var p = PROVIDERS[cfg.provider];
    if (p.type === 'anthropic') {
      return {
        'x-api-key': cfg.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      };
    }
    return { 'Authorization': 'Bearer ' + cfg.apiKey };
  }

  function fetchModels(cfg) {
    return fetch(currentBase(cfg) + '/models', { headers: authHeaders(cfg) })
      .then(checkResponse)
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var arr = j.data || j.models || [];
        return arr.map(function (m) { return String(m.id || m.name || '').replace(/^models\//, ''); })
                  .filter(Boolean).sort();
      });
  }

  function checkResponse(res) {
    if (res.ok) return res;
    return res.text().then(function (t) {
      var detail = t;
      try { var j = JSON.parse(t); detail = (j.error && (j.error.message || j.error)) || j.message || t; } catch (e) {}
      var e = new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
      e.status = res.status;
      throw e;
    });
  }

  function isModelError(e) {
    return !!e && (e.status === 400 || e.status === 404) &&
           /model|decommission|not.?found|deprecat/i.test(e.message || '');
  }

  function explainError(e) {
    if (e && e.name === 'AbortError') return 'Génération interrompue.';
    if (e && e.status === 401) return 'Clé API refusée (401). Vérifiez la clé et le fournisseur choisi.';
    if (e && e.status === 403) return 'Accès refusé (403). ' + (e.message || '');
    var msg = (e && e.message) || '';
    if (isModelError(e)) {
      return 'Ce modèle est introuvable ou a été retiré par le fournisseur.\n' +
             'Choisissez un autre modèle dans la liste en haut de la page.\n' + msg;
    }
    if (e && e.status === 404) return 'Introuvable (404). Vérifiez le nom du modèle ou l\'URL de base.\n' + msg;
    if (e && e.status === 429) return 'Quota ou limite de débit atteint (429). Patientez un peu ou changez de modèle.\n' + msg;
    if (e && e.status) return 'Erreur ' + e.status + ' : ' + msg;
    if (e && e.message && !e.status && e.name !== 'TypeError') return e.message;
    return 'Impossible de joindre le fournisseur. Causes possibles : pas de connexion, ' +
           'ou ce fournisseur n\'autorise pas les appels directs depuis un navigateur (blocage CORS).';
  }

  // Lecture d'un flux SSE : appelle onData(chaîneJSON) pour chaque ligne "data:"
  function readSSE(res, onData) {
    var reader = res.body.getReader();
    var decoder = new TextDecoder();
    var buf = '';
    function pump() {
      return reader.read().then(function (r) {
        if (r.done) return;
        buf += decoder.decode(r.value, { stream: true });
        var lines = buf.split('\n');
        buf = lines.pop();
        lines.forEach(function (line) {
          line = line.trim();
          if (line.indexOf('data:') === 0) onData(line.slice(5).trim());
        });
        return pump();
      });
    }
    return pump();
  }

  function streamChat(cfg, msgs, system, signal, onToken) {
    var p = PROVIDERS[cfg.provider];
    var url, body;

    if (p.type === 'anthropic') {
      url = currentBase(cfg) + '/messages';
      body = { model: cfg.model, max_tokens: 4096, stream: true, messages: msgs };
      if (system) body.system = system;
    } else {
      url = currentBase(cfg) + '/chat/completions';
      var all = system ? [{ role: 'system', content: system }].concat(msgs) : msgs;
      body = { model: cfg.model, stream: true, messages: all };
    }

    var headers = authHeaders(cfg);
    headers['Content-Type'] = 'application/json';

    return fetch(url, { method: 'POST', headers: headers, body: JSON.stringify(body), signal: signal })
      .then(checkResponse)
      .then(function (res) {
        return readSSE(res, function (data) {
          if (data === '[DONE]') return;
          var j;
          try { j = JSON.parse(data); } catch (e) { return; }
          if (p.type === 'anthropic') {
            if (j.type === 'content_block_delta' && j.delta && j.delta.text) onToken(j.delta.text);
          } else {
            var d = j.choices && j.choices[0] && j.choices[0].delta;
            if (d && d.content) onToken(d.content);
          }
        });
      });
  }

  // ---------- Rendu des messages (sécurisé : on échappe avant de mettre en forme) ----------
  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function renderMarkdown(text) {
    return text.split('```').map(function (part, i) {
      if (i % 2 === 1) return '<pre><code>' + esc(part.replace(/^[\w+#.]*\n/, '')) + '</code></pre>';
      return esc(part)
        .replace(/`([^`\n]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\n/g, '<br>');
    }).join('');
  }

  function addMessage(role, text) {
    var div = document.createElement('div');
    div.className = 'msg ' + role;
    if (role === 'assistant') div.innerHTML = renderMarkdown(text); else div.textContent = text;
    els.messages.appendChild(div);
    els.messages.scrollTop = els.messages.scrollHeight;
    return div;
  }

  // ---------- Sélecteur de modèle (en haut du chat) ----------
  function fillModelSelect() {
    var ids = availableModels.slice();
    if (ids.indexOf(config.model) === -1) ids.unshift(config.model);
    els.modelSelect.innerHTML = '';
    ids.forEach(function (id) {
      var o = document.createElement('option');
      o.value = id; o.textContent = id;
      els.modelSelect.appendChild(o);
    });
    els.modelSelect.value = config.model;
  }

  els.modelSelect.addEventListener('change', function () {
    config.model = els.modelSelect.value;
    config.auto = false; // choix manuel : plus de bascule automatique
    persist();
    addMessage('system', 'Modèle changé : ' + config.model);
  });


  // ---------- Enregistrement des échanges dans Firestore (optionnel, désactivé par défaut) ----------
  function setSaveStatus(text, cls) {
    els.saveStatus.textContent = text;
    els.saveStatus.className = cls || '';
  }

  function refreshSaveBox() {
    var ok = !!(window.FirebaseSave && window.firebaseApp);
    els.saveFirestore.disabled = !ok;
    if (!ok) { saving = false; els.saveFirestore.checked = false; setSaveStatus('Firebase non configuré (voir public/firebase-config.js)'); }
    else if (!saving) setSaveStatus('Désactivé : rien n\'est envoyé à Firebase');
  }

  els.saveFirestore.addEventListener('change', function () {
    if (!els.saveFirestore.checked) {
      saving = false;
      setSaveStatus('Désactivé : rien n\'est envoyé à Firebase');
      return;
    }
    els.saveFirestore.disabled = true;
    setSaveStatus('Connexion à Firebase…');
    window.FirebaseSave.enable().then(function () {
      saving = true;
      setSaveStatus('Actif : vos messages (jamais votre clé API) sont enregistrés dans le projet ' + window.FirebaseSave.projectId, 'ok');
    }).catch(function (e) {
      saving = false;
      els.saveFirestore.checked = false;
      setSaveStatus('Activation impossible', 'err');
      addMessage('error', 'Impossible d\'activer l\'enregistrement Firestore : ' + ((e && e.message) || e) +
        '\nVérifiez dans la console Firebase que l\'authentification anonyme et Firestore sont activés.');
    }).then(function () {
      els.saveFirestore.disabled = false;
    });
  });

  function saveExchange(userText, answerText) {
    if (!saving || !window.FirebaseSave) return;
    window.FirebaseSave.saveExchange({
      convId: convId, startedAt: convStartedAt,
      provider: config.provider, model: config.model,
      user: userText, assistant: answerText
    }).catch(function (e) {
      saving = false;
      els.saveFirestore.checked = false;
      setSaveStatus('Enregistrement interrompu', 'err');
      addMessage('error', 'Échec de l\'enregistrement Firestore (désactivé) : ' + ((e && e.message) || e));
    });
  }

  // ---------- Écran de conversation ----------
  function startChat() {
    els.setup.hidden = true;
    els.chat.hidden = false;
    els.badge.textContent = PROVIDERS[config.provider].label;
    fillModelSelect();
    resetConversation();
    els.input.focus();

    if (!availableModels.length) {
      fetchModels(config).then(function (ids) {
        availableModels = ids.filter(isChatModel);
        fillModelSelect();
      }).catch(function () { /* la liste reste limitée au modèle courant */ });
    }
  }

  function resetConversation() {
    if (controller) controller.abort();
    convId = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    convStartedAt = new Date().toISOString();
    history = [];
    els.messages.innerHTML = '';
    addMessage('system', 'Conversation prête. Posez votre première question.');
  }

  function setBusy(busy) {
    els.send.hidden = busy;
    els.stop.hidden = !busy;
    els.input.disabled = busy;
    els.modelSelect.disabled = busy;
    if (!busy) els.input.focus();
  }

  function sendMessage() {
    var text = els.input.value.trim();
    if (!text || controller) return;
    els.input.value = '';
    addMessage('user', text);
    history.push({ role: 'user', content: text });

    var bubble = addMessage('assistant', '…');
    var answer = '';
    controller = new AbortController();
    setBusy(true);

    // Tente la requête. En mode automatique, si le modèle est retiré, bascule une fois sur un autre.
    function attempt(retried) {
      return streamChat(config, history, els.systemPrompt.value.trim(), controller.signal, function (tok) {
        answer += tok;
        bubble.innerHTML = renderMarkdown(answer);
        els.messages.scrollTop = els.messages.scrollHeight;
      }).catch(function (e) {
        if (!answer && !retried && config.auto && isModelError(e)) {
          return fetchModels(config).then(function (ids) {
            availableModels = ids.filter(isChatModel);
            var next = pickModel(config, ids, [config.model]);
            if (!next) throw e;
            var old = config.model;
            config.model = next;
            persist();
            fillModelSelect();
            addMessage('system', 'Le modèle ' + old + ' est indisponible. Bascule automatique sur ' + next + '.');
            return attempt(true);
          });
        }
        throw e;
      });
    }

    attempt(false).then(function () {
      if (!answer) { bubble.remove(); addMessage('error', 'Réponse vide du modèle.'); history.pop(); }
      else { history.push({ role: 'assistant', content: answer }); saveExchange(text, answer); }
    }).catch(function (e) {
      if (answer) {
        history.push({ role: 'assistant', content: answer });
      } else {
        bubble.remove();
        history.pop();
      }
      addMessage('error', explainError(e));
    }).then(function () {
      controller = null;
      setBusy(false);
    });
  }

  els.chatForm.addEventListener('submit', function (ev) { ev.preventDefault(); sendMessage(); });
  els.input.addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); sendMessage(); }
  });
  els.stop.addEventListener('click', function () { if (controller) controller.abort(); });
  els.newChat.addEventListener('click', resetConversation);
  els.logout.addEventListener('click', function () {
    if (controller) controller.abort();
    clearConfig();
    config = null;
    availableModels = [];
    saving = false;
    els.saveFirestore.checked = false;
    refreshSaveBox();
    els.chat.hidden = true;
    els.setup.hidden = false;
    els.apiKey.value = '';
  });
})();
