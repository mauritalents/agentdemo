(function () {
  'use strict';

  // ---------- Fournisseurs ----------
  // "type: openai" = API compatible OpenAI (/chat/completions). Les modèles par défaut
  // sont des suggestions : utilisez "Charger la liste" pour voir les modèles réellement disponibles.
  var PROVIDERS = {
    groq:       { label: 'Groq',                type: 'openai',    base: 'https://api.groq.com/openai/v1',                          model: 'openai/gpt-oss-120b',      keyUrl: 'https://console.groq.com/keys' },
    openai:     { label: 'OpenAI',              type: 'openai',    base: 'https://api.openai.com/v1',                               model: 'gpt-4o-mini',              keyUrl: 'https://platform.openai.com/api-keys' },
    mistral:    { label: 'Mistral',             type: 'openai',    base: 'https://api.mistral.ai/v1',                               model: 'mistral-small-latest',     keyUrl: 'https://console.mistral.ai/api-keys' },
    openrouter: { label: 'OpenRouter',          type: 'openai',    base: 'https://openrouter.ai/api/v1',                            model: 'openai/gpt-4o-mini',       keyUrl: 'https://openrouter.ai/keys' },
    gemini:     { label: 'Google Gemini',       type: 'openai',    base: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash',         keyUrl: 'https://aistudio.google.com/apikey' },
    together:   { label: 'Together AI',         type: 'openai',    base: 'https://api.together.xyz/v1',                             model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', keyUrl: 'https://api.together.ai/settings/api-keys' },
    anthropic:  { label: 'Anthropic (Claude)',  type: 'anthropic', base: 'https://api.anthropic.com/v1',                            model: 'claude-sonnet-5-5',        keyUrl: 'https://console.anthropic.com/settings/keys' },
    custom:     { label: 'Autre (compatible OpenAI)', type: 'openai', base: '',                                                      model: '',                         keyUrl: '' }
  };

  var DEFAULT_SYSTEM = "Tu es un assistant utile, clair et concis. Tu réponds en français sauf si l'utilisateur écrit dans une autre langue.";
  var STORE_KEY = 'agentdemo_config';

  // ---------- Éléments ----------
  var $ = function (id) { return document.getElementById(id); };
  var els = {
    setup: $('setup'), setupForm: $('setupForm'), provider: $('provider'),
    customBox: $('customBox'), customUrl: $('customUrl'), apiKey: $('apiKey'),
    keyLink: $('keyLink'), model: $('model'), modelList: $('modelList'),
    loadModels: $('loadModels'), remember: $('remember'), setupError: $('setupError'),
    chat: $('chat'), badge: $('badge'), newChat: $('newChat'), logout: $('logout'),
    systemPrompt: $('systemPrompt'), messages: $('messages'), chatForm: $('chatForm'),
    input: $('input'), send: $('send'), stop: $('stop')
  };

  var config = null;     // { provider, customUrl, apiKey, model }
  var history = [];      // [{role, content}]
  var controller = null; // AbortController de la requête en cours

  // ---------- Initialisation ----------
  Object.keys(PROVIDERS).forEach(function (k) {
    var o = document.createElement('option');
    o.value = k; o.textContent = PROVIDERS[k].label;
    els.provider.appendChild(o);
  });
  els.systemPrompt.value = DEFAULT_SYSTEM;
  onProviderChange(true);

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
  function clearConfig() {
    try { sessionStorage.removeItem(STORE_KEY); localStorage.removeItem(STORE_KEY); } catch (e) {}
  }

  // ---------- Écran de configuration ----------
  function onProviderChange(setDefaultModel) {
    var p = PROVIDERS[els.provider.value];
    els.customBox.hidden = els.provider.value !== 'custom';
    if (p.keyUrl) { els.keyLink.href = p.keyUrl; els.keyLink.hidden = false; } else { els.keyLink.hidden = true; }
    if (setDefaultModel) els.model.value = p.model;
    els.modelList.innerHTML = '';
  }
  els.provider.addEventListener('change', function () { onProviderChange(true); });

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
      model: els.model.value.trim()
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
      ids.forEach(function (id) {
        var o = document.createElement('option'); o.value = id; els.modelList.appendChild(o);
      });
      showSetupError(ids.length ? '' : 'Aucun modèle renvoyé. Saisissez le nom du modèle à la main.');
      if (ids.length) els.model.focus();
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
    if (!cfg.model) err = err || 'Veuillez indiquer un modèle.';
    if (err) { showSetupError(err); return; }
    showSetupError('');
    config = cfg;
    saveConfig(cfg, els.remember.checked);
    els.apiKey.value = '';
    startChat();
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

  function explainError(e) {
    if (e && e.name === 'AbortError') return 'Génération interrompue.';
    if (e && e.status === 401) return 'Clé API refusée (401). Vérifiez la clé et le fournisseur choisi.';
    if (e && e.status === 403) return 'Accès refusé (403). ' + (e.message || '');
    var msg = (e && e.message) || '';
    if (e && (e.status === 400 || e.status === 404) && /model|decommission|not.?found|deprecat/i.test(msg)) {
      return 'Ce modèle est introuvable ou a été retiré par le fournisseur.\n' +
             'Cliquez sur « Changer de clé », puis sur « Charger la liste » pour choisir un modèle disponible.\n' + msg;
    }
    if (e && e.status === 404) return 'Introuvable (404). Vérifiez le nom du modèle ou l\'URL de base.\n' + msg;
    if (e && e.status === 429) return 'Quota ou limite de débit atteint (429). Patientez un peu ou changez de modèle.\n' + (e.message || '');
    if (e && e.status) return 'Erreur ' + e.status + ' : ' + (e.message || '');
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

  // ---------- Écran de conversation ----------
  function startChat() {
    els.setup.hidden = true;
    els.chat.hidden = false;
    els.badge.textContent = PROVIDERS[config.provider].label + ' · ' + config.model;
    resetConversation();
    els.input.focus();
  }

  function resetConversation() {
    if (controller) controller.abort();
    history = [];
    els.messages.innerHTML = '';
    addMessage('system', 'Conversation prête. Posez votre première question.');
  }

  function setBusy(busy) {
    els.send.hidden = busy;
    els.stop.hidden = !busy;
    els.input.disabled = busy;
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

    streamChat(config, history, els.systemPrompt.value.trim(), controller.signal, function (tok) {
      answer += tok;
      bubble.innerHTML = renderMarkdown(answer);
      els.messages.scrollTop = els.messages.scrollHeight;
    }).then(function () {
      if (!answer) { bubble.remove(); addMessage('error', 'Réponse vide du modèle.'); history.pop(); }
      else history.push({ role: 'assistant', content: answer });
    }).catch(function (e) {
      if (answer) {
        history.push({ role: 'assistant', content: answer });
        addMessage('error', explainError(e));
      } else {
        bubble.remove();
        history.pop();
        addMessage('error', explainError(e));
      }
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
    els.chat.hidden = true;
    els.setup.hidden = false;
    els.apiKey.value = '';
  });
})();
