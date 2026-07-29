(function () {
  'use strict';

  const socket = io();

  // Elementy DOM
  const screens = {
    login: document.getElementById('screen-login'),
    lobby: document.getElementById('screen-lobby'),
    game: document.getElementById('screen-game'),
    result: document.getElementById('screen-result'),
  };

  const elements = {
    nickInput: document.getElementById('nick-input'),
    btnJoin: document.getElementById('btn-join'),
    loginError: document.getElementById('login-error'),
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
    hostCancel: document.getElementById('host-cancel'),
    btnCancel: document.getElementById('btn-cancel'),
    resultMessage: document.getElementById('result-message'),
    hostRestart: document.getElementById('host-restart'),
    btnRestart: document.getElementById('btn-restart'),
  };

  // Stan klienta
  let myId = null;
  let isHost = false;
  let myNick = '';

  // Nawigacja ekranów
  function showScreen(name) {
    Object.values(screens).forEach((s) => s.classList.remove('active'));
    screens[name].classList.add('active');
  }

  // Dołączanie do gry
  elements.btnJoin.addEventListener('click', joinGame);
  elements.nickInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') joinGame();
  });

  function joinGame() {
    const nick = elements.nickInput.value.trim();
    elements.loginError.textContent = '';

    if (!nick) {
      elements.loginError.textContent = 'Wpisz nick.';
      return;
    }

    if (nick.length > 20) {
      elements.loginError.textContent = 'Nick może mieć maksymalnie 20 znaków.';
      return;
    }

    socket.emit('join', nick, (response) => {
      if (response.success) {
        myNick = nick;
        myId = socket.id;
        isHost = response.isHost;
        showScreen('lobby');
        updateHostUI();
        document.getElementById('version-footer').textContent = 'v' + response.version;
      } else {
        elements.loginError.textContent = response.error;
      }
    });
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

  // Sprawdzanie rozmiaru okna i zooma
  function isWindowMaximized() {
    return window.innerWidth >= screen.availWidth * 0.9 && window.innerHeight >= screen.availHeight * 0.85;
  }

  function isZoomNormal() {
    const zoom = Math.round(window.devicePixelRatio * 100);
    return zoom >= 90 && zoom <= 110;
  }

  let windowCheckInterval = null;

  function startWindowCheck() {
    windowCheckInterval = setInterval(() => {
      if (!isWindowMaximized()) {
        socket.emit('window-minimized');
      } else if (!isZoomNormal()) {
        socket.emit('zoom-changed');
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
    if (!isWindowMaximized()) {
      socket.emit('window-minimized');
      return;
    }
    showScreen('game');
    elements.gameStatus.textContent = 'Runda trwa! Laptop krąży...';
    updateGameView(data.holderId, data.holderNick);
    if (isHost) {
      elements.hostCancel.classList.remove('hidden');
    } else {
      elements.hostCancel.classList.add('hidden');
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
    // Fallback - odblokuj po 2s gdyby serwer nie odpowiedział
    throwTimeout = setTimeout(() => {
      elements.btnThrow.disabled = false;
    }, 2000);
  });

  // Serwer odrzucił rzut (cooldown)
  socket.on('throw-rejected', () => {
    elements.btnThrow.disabled = false;
    if (throwTimeout) clearTimeout(throwTimeout);
  });

  // Anuluj rundę (host)
  elements.btnCancel.addEventListener('click', () => {
    socket.emit('cancel-round');
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
