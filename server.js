const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const os = require('os');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// Stan gry
const state = {
  players: new Map(), // socketId -> { nick, isHost }
  gameStarted: false,
  currentHolder: null, // socketId gracza z laptopem
  timer: null,
  lastThrowTime: new Map(), // socketId -> timestamp (anti-spam)
};

const THROW_COOLDOWN_MS = 1000; // 1 sekunda cooldown na rzucanie
const TIMER_MIN_SEC = 20;
const TIMER_MAX_SEC = 120;

function getPlayerList() {
  const list = [];
  for (const [id, player] of state.players) {
    list.push({ id, nick: player.nick, isHost: player.isHost });
  }
  return list;
}

function getRandomTimer() {
  const seconds = Math.floor(Math.random() * (TIMER_MAX_SEC - TIMER_MIN_SEC + 1)) + TIMER_MIN_SEC;
  return seconds * 1000;
}

function getRandomPlayer(excludeId) {
  const candidates = [];
  for (const [id] of state.players) {
    if (id !== excludeId) {
      candidates.push(id);
    }
  }
  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function endRound(loserId) {
  clearTimeout(state.timer);
  state.timer = null;
  state.gameStarted = false;

  const loser = state.players.get(loserId);
  const loserNick = loser ? loser.nick : 'Nieznany';

  io.emit('round-end', { loserNick, loserId });
  state.currentHolder = null;
}

function startExplosionTimer(duration) {
  state.timer = setTimeout(() => {
    if (state.currentHolder && state.players.has(state.currentHolder)) {
      endRound(state.currentHolder);
    }
  }, duration);
}

io.on('connection', (socket) => {
  console.log(`Połączono: ${socket.id}`);

  socket.on('join', (nick, callback) => {
    // Walidacja nicku
    if (!nick || typeof nick !== 'string') {
      return callback({ success: false, error: 'Nick jest wymagany.' });
    }

    nick = nick.trim();

    if (nick.length < 1 || nick.length > 20) {
      return callback({ success: false, error: 'Nick musi mieć od 1 do 20 znaków.' });
    }

    if (!/^[a-zA-Z0-9ąćęłńóśźżĄĆĘŁŃÓŚŹŻ _\-]+$/.test(nick)) {
      return callback({ success: false, error: 'Nick zawiera niedozwolone znaki.' });
    }

    // Sprawdź duplikat nicku
    for (const [id, player] of state.players) {
      if (player.nick.toLowerCase() === nick.toLowerCase() && id !== socket.id) {
        return callback({ success: false, error: 'Nick jest już zajęty.' });
      }
    }

    // Pierwszy gracz jest hostem
    const isHost = state.players.size === 0;

    state.players.set(socket.id, { nick, isHost });
    callback({ success: true, isHost });

    io.emit('player-list', getPlayerList());
    console.log(`Dołączył: ${nick} (host: ${isHost})`);
  });

  socket.on('start-game', () => {
    const player = state.players.get(socket.id);
    if (!player || !player.isHost) return;
    if (state.gameStarted) return;
    if (state.players.size < 2) {
      socket.emit('error-msg', 'Potrzeba minimum 2 graczy.');
      return;
    }

    state.gameStarted = true;

    // Losuj pierwszego posiadacza
    const playerIds = Array.from(state.players.keys());
    const firstHolder = playerIds[Math.floor(Math.random() * playerIds.length)];
    state.currentHolder = firstHolder;

    // Losuj czas wybuchu
    const duration = getRandomTimer();
    console.log(`Runda rozpoczęta. Timer: ${duration / 1000}s. Pierwszy: ${state.players.get(firstHolder).nick}`);

    startExplosionTimer(duration);

    io.emit('game-started', {
      holderId: firstHolder,
      holderNick: state.players.get(firstHolder).nick,
    });
  });

  socket.on('throw-laptop', () => {
    if (!state.gameStarted) return;
    if (state.currentHolder !== socket.id) return;

    // Anti-spam
    const now = Date.now();
    const lastThrow = state.lastThrowTime.get(socket.id) || 0;
    if (now - lastThrow < THROW_COOLDOWN_MS) return;
    state.lastThrowTime.set(socket.id, now);

    // Losuj nowego posiadacza
    const newHolder = getRandomPlayer(socket.id);
    if (!newHolder) return; // Brak innego gracza

    state.currentHolder = newHolder;

    const newHolderPlayer = state.players.get(newHolder);
    io.emit('laptop-thrown', {
      fromId: socket.id,
      fromNick: state.players.get(socket.id).nick,
      toId: newHolder,
      toNick: newHolderPlayer.nick,
    });
  });

  socket.on('disconnect', () => {
    const player = state.players.get(socket.id);
    if (!player) return;

    console.log(`Rozłączono: ${player.nick}`);

    const wasHost = player.isHost;
    const wasHolder = state.currentHolder === socket.id;

    state.players.delete(socket.id);
    state.lastThrowTime.delete(socket.id);

    // Jeśli host się rozłączył, wyznacz nowego
    if (wasHost && state.players.size > 0) {
      const firstPlayer = state.players.entries().next().value;
      if (firstPlayer) {
        firstPlayer[1].isHost = true;
        io.to(firstPlayer[0]).emit('you-are-host');
      }
    }

    // Jeśli posiadacz laptopa się rozłączył w trakcie gry
    if (wasHolder && state.gameStarted) {
      if (state.players.size < 2) {
        // Za mało graczy - zakończ rundę
        clearTimeout(state.timer);
        state.timer = null;
        state.gameStarted = false;
        state.currentHolder = null;
        io.emit('game-cancelled', 'Za mało graczy. Runda anulowana.');
      } else {
        // Przekaż laptopa losowej osobie
        const newHolder = getRandomPlayer(null); // null bo gracza już nie ma
        if (newHolder) {
          state.currentHolder = newHolder;
          io.emit('laptop-thrown', {
            fromId: socket.id,
            fromNick: player.nick + ' (rozłączony)',
            toId: newHolder,
            toNick: state.players.get(newHolder).nick,
          });
        }
      }
    }

    // Jeśli za mało graczy zostało i gra trwa
    if (state.gameStarted && state.players.size < 2) {
      clearTimeout(state.timer);
      state.timer = null;
      state.gameStarted = false;
      state.currentHolder = null;
      io.emit('game-cancelled', 'Za mało graczy. Runda anulowana.');
    }

    io.emit('player-list', getPlayerList());
  });
});

// Znajdź adresy IP w sieci lokalnej
function getLocalIPs() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push(iface.address);
      }
    }
  }
  return ips;
}

const PORT = process.env.PORT || 3000;

server.listen(PORT, '0.0.0.0', () => {
  const ips = getLocalIPs();
  console.log('');
  console.log('=================================');
  console.log('   🥔 Daily Ziemniak Server 🥔');
  console.log('=================================');
  console.log('');
  console.log(`Serwer działa na porcie ${PORT}`);
  console.log('');
  console.log('Adresy do połączenia w LAN:');
  ips.forEach((ip) => {
    console.log(`  http://${ip}:${PORT}`);
  });
  console.log('');
  console.log('Gracze powinni otworzyć powyższy adres w przeglądarce.');
  console.log('=================================');
  console.log('');
});
