(function () {
  'use strict';

  const socket = io();

  // Elementy DOM
  const screens = {
    menu: document.getElementById('screen-menu'),
    create: document.getElementById('screen-create'),
    join: document.getElementById('screen-join'),
    lobby: document.getElementById('screen-lobby'),
    game: document.getElementById('screen-game'),
    result: document.getElementById('screen-result'),
  };

  const elements = {
    btnCreate: document.getElementById('btn-create'),
    btnJoinMenu: document.getElementById('btn-join-menu'),
    createNickInput: document.getElementById('create-nick-input'),
    btnCreateConfirm: document.getElementById('btn-create-confirm'),
    createError: document.getElementById('create-error'),
    joinCodeInput: document.getElementById('join-code-input'),
    joinNickInput: document.getElementById('join-nick-input'),
    btnJoinConfirm: document.getElementById('btn-join-confirm'),
    joinError: document.getElementById('join-error'),
    sessionCodeDisplay: document.getElementById('session-code-display'),
    playerList: document.getElementById('player-list'),
    playerCount: document.getElementById('player-count'),
    hostControls: document.getElementById('host-controls'),
    btnStart: document.getElementById('btn-start'),
    lobbyInfo: document.getElementById('lobby-info'),
    lobbyError: document.getElementById('lobby-error'),
    gameStatus: document.getElementById('game-status'),
    gameHolderInfo: document.getElementById('game-holder-info'),
    gameAction: document.getElementById('game-action'),
    btnThrow: document.getElementById('btn-throw'),
    hostCancelHint: document.getElementById('host-cancel-hint'),
    resultMessage: document.getElementById('result-message'),
    hostRestart: document.getElementById('host-restart'),
    btnRestart: document.getElementById('btn-restart'),
  };

  // Stan klienta
  let myId = null;
  let isHost = false;
  let myNick = '';
  let sessionCode = '';

  // Nawigacja ekranów
  function showScreen(name) {
    Object.values(screens).forEach((s) => s.classList.remove('active'));
    screens[name].classList.add('active');
  }

  // Menu główne
  elements.btnCreate.addEventListener('click', () => showScreen('create'));
  elements.btnJoinMenu.addEventListener('click', () => showScreen('join'));

  // Tworzenie sesji
  elements.btnCreateConfirm.addEventListener('click', createSession);
  elements.createNickInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') createSession();
  });

  function createSession() {
    const nick = elements.createNickInput.value.trim();
    elements.createError.textContent = '';

    if (!nick) {
      elements.createError.textContent = 'Wpisz nick.';
      return;
    }

    socket.emit('create-session', nick, (response) => {
      if (response.success) {
        myNick = nick;
        myId = socket.id;
        isHost = true;
        sessionCode = response.code;
        document.getElementById('version-footer').textContent = 'v' + response.version;
        enterLobby();
      } else {
        elements.createError.textContent = response.error;
      }
    });
  }

  // Dołączanie do sesji
  elements.btnJoinConfirm.addEventListener('click', joinSession);
  elements.joinNickInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') joinSession();
  });
  elements.joinCodeInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') joinSession();
  });

  function joinSession() {
    const code = elements.joinCodeInput.value.trim().toUpperCase();
    const nick = elements.joinNickInput.value.trim();
    elements.joinError.textContent = '';

    if (!code) {
      elements.joinError.textContent = 'Wpisz kod sesji.';
      return;
    }
    if (!nick) {
      elements.joinError.textContent = 'Wpisz nick.';
      return;
    }

    socket.emit('join-session', { code, nick }, (response) => {
      if (response.success) {
        myNick = nick;
        myId = socket.id;
        isHost = false;
        sessionCode = response.code;
        document.getElementById('version-footer').textContent = 'v' + response.version;
        enterLobby();
      } else {
        elements.joinError.textContent = response.error;
      }
    });
  }

  function enterLobby() {
    showScreen('lobby');
    elements.sessionCodeDisplay.textContent = 'Kod sesji: ' + sessionCode;
    updateHostUI();
  }

  function updateHostUI() {
    if (isHost) {
      elements.hostControls.classList.remove('hidden');
      elements.lobbyInfo.textContent = 'Jesteś hostem. Kliknij START gdy wszyscy będą gotowi.';
    } else {
      elements.hostControls.classList.add('hidden');
      elements.lobbyInfo.textContent = 'Czekam na hosta...';
    }
  }

  // Lista graczy
  socket.on('player-list', (players) => {
    elements.playerList.innerHTML = '';
    elements.playerCount.textContent = players.length;

    players.forEach((p) => {
      const li = document.createElement('li');
      li.textContent = p.nick;
      if (p.isHost) li.classList.add('host');
      if (p.id === myId) li.textContent += ' (Ty)';
      elements.playerList.appendChild(li);
    });
  });

  // Host START
  elements.btnStart.addEventListener('click', () => {
    elements.lobbyError.textContent = '';
    socket.emit('start-game');
  });

  // Restart
  elements.btnRestart.addEventListener('click', () => {
    elements.lobbyError.textContent = '';
    socket.emit('start-game');
  });

  // Sprawdzanie rozmiaru okna - zapamiętaj na starcie i wykrywaj zmniejszenie
  let startWidth = null;
  let startHeight = null;

  function isWindowShrunk() {
    if (startWidth === null) return false;
    return window.innerWidth < startWidth || window.innerHeight < startHeight;
  }

  let windowCheckInterval = null;

  function startWindowCheck() {
    startWidth = window.innerWidth;
    startHeight = window.innerHeight;
    windowCheckInterval = setInterval(() => {
      if (isWindowShrunk()) {
        socket.emit('window-minimized');
      }
    }, 1000);
  }

  function stopWindowCheck() {
    if (windowCheckInterval) {
      clearInterval(windowCheckInterval);
      windowCheckInterval = null;
    }
  }

  // Gra rozpoczęta
  socket.on('game-started', (data) => {
    // Wymuś minimalny rozmiar okna na starcie (80% ekranu)
    if (window.innerWidth < screen.availWidth * 0.8 || window.innerHeight < screen.availHeight * 0.75) {
      socket.emit('window-minimized');
      return;
    }
    showScreen('game');
    elements.gameStatus.textContent = 'Runda trwa! Laptop krąży...';
    updateGameView(data.holderId, data.holderNick);
    if (isHost) {
      elements.hostCancelHint.classList.remove('hidden');
    } else {
      elements.hostCancelHint.classList.add('hidden');
    }
    startWindowCheck();
  });

  // Laptop rzucony
  socket.on('laptop-thrown', (data) => {
    updateGameView(data.toId, data.toNick);
  });

  function updateGameView(holderId, holderNick) {
    if (throwTimeout) clearTimeout(throwTimeout);
    if (holderId === myId) {
      elements.gameHolderInfo.textContent = 'Masz laptopa 💻';
      elements.gameHolderInfo.classList.add('you-have-it');
      elements.gameAction.classList.remove('hidden');
      elements.btnThrow.disabled = false;
      randomizeThrowPosition();
    } else {
      elements.gameHolderInfo.textContent = holderNick + ' ma laptopa 💻';
      elements.gameHolderInfo.classList.remove('you-have-it');
      elements.gameAction.classList.add('hidden');
    }
  }

  function randomizeThrowPosition() {
    const maxX = window.innerWidth - 200;
    const maxY = window.innerHeight - 80;
    const x = Math.max(10, Math.floor(Math.random() * maxX));
    const y = Math.max(10, Math.floor(Math.random() * maxY));
    elements.gameAction.style.position = 'fixed';
    elements.gameAction.style.left = x + 'px';
    elements.gameAction.style.top = y + 'px';
  }

  // Rzuć laptopem
  let throwTimeout = null;
  elements.btnThrow.addEventListener('click', () => {
    elements.btnThrow.disabled = true;
    socket.emit('throw-laptop');
    throwTimeout = setTimeout(() => {
      elements.btnThrow.disabled = false;
    }, 2000);
  });

  // Serwer odrzucił rzut (cooldown)
  socket.on('throw-rejected', () => {
    elements.btnThrow.disabled = false;
    if (throwTimeout) clearTimeout(throwTimeout);
  });

  // Anuluj rundę (host) - klawisz Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isHost) {
      socket.emit('cancel-round');
    }
  });

  // Koniec rundy
  socket.on('round-end', (data) => {
    stopWindowCheck();
    showScreen('result');
    elements.resultMessage.innerHTML =
      '<span class="loser-name">' + escapeHtml(data.loserNick) + '</span><br><br>' +
      'bierze laptopa na daily 💻';

    if (isHost) {
      elements.hostRestart.classList.remove('hidden');
    } else {
      elements.hostRestart.classList.add('hidden');
    }
  });

  // Gra anulowana - wróć do lobby
  socket.on('game-cancelled', (msg) => {
    stopWindowCheck();
    showScreen('lobby');
    updateHostUI();
    elements.lobbyError.textContent = msg;
  });

  // Zostałeś hostem
  socket.on('you-are-host', () => {
    isHost = true;
    updateHostUI();
  });

  // Błąd
  socket.on('error-msg', (msg) => {
    elements.lobbyError.textContent = msg;
    setTimeout(() => {
      elements.lobbyError.textContent = '';
    }, 3000);
  });

  // Helpers
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
})();
