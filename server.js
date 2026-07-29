const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const os = require('os');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const VERSION = '1.007';

const THROW_COOLDOWN_MS = 1000;
const TIMER_MIN_SEC = 15;
const TIMER_MAX_SEC = 45;

// Sesje: code -> session
const sessions = new Map();

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // bez I i O (mylone z 1 i 0)
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  // Sprawdź unikalność
  if (sessions.has(code)) return generateCode();
  return code;
}

function createSession(hostId, hostNick) {
  const code = generateCode();
  const session = {
    code,
    players: new Map(), // socketId -> { nick, isHost }
    gameStarted: false,
    currentHolder: null,
    timer: null,
    lastThrowTime: new Map(),
  };
  session.players.set(hostId, { nick: hostNick, isHost: true });
  sessions.set(code, session);
  return session;
}

function getSessionByPlayer(socketId) {
  for (const [code, session] of sessions) {
    if (session.players.has(socketId)) return session;
  }
  return null;
}

function getPlayerList(session) {
  const list = [];
  for (const [id, player] of session.players) {
    list.push({ id, nick: player.nick, isHost: player.isHost });
  }
  return list;
}

function getRandomTimer() {
  const seconds = Math.floor(Math.random() * (TIMER_MAX_SEC - TIMER_MIN_SEC + 1)) + TIMER_MIN_SEC;
  return seconds * 1000;
}

function getRandomPlayer(session, excludeId) {
  const candidates = [];
  for (const [id] of session.players) {
    if (id !== excludeId) {
      candidates.push(id);
    }
  }
  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function endRound(session) {
  clearTimeout(session.timer);
  session.timer = null;
  session.gameStarted = false;

  const loser = session.players.get(session.currentHolder);
  const loserNick = loser ? loser.nick : 'Nieznany';

  io.to(session.code).emit('round-end', { loserNick, loserId: session.currentHolder });
  session.currentHolder = null;
}

function startExplosionTimer(session, duration) {
  session.timer = setTimeout(() => {
    if (session.currentHolder && session.players.has(session.currentHolder)) {
      console.log(`[${session.code}] BOOM! Przegrał: ${session.players.get(session.currentHolder).nick}`);
      endRound(session);
    } else {
      console.log(`[${session.code}] Timer skończony ale holder nie istnieje. Losowy przegrany.`);
      const playerIds = Array.from(session.players.keys());
      if (playerIds.length > 0) {
        session.currentHolder = playerIds[Math.floor(Math.random() * playerIds.length)];
        endRound(session);
      } else {
        session.gameStarted = false;
        session.timer = null;
        session.currentHolder = null;
      }
    }
  }, duration);
}

function cancelRound(session, message) {
  clearTimeout(session.timer);
  session.timer = null;
  session.gameStarted = false;
  session.currentHolder = null;
  io.to(session.code).emit('game-cancelled', message);
}

io.on('connection', (socket) => {
  console.log(`Połączono: ${socket.id}`);

  // Tworzenie sesji
  socket.on('create-session', (nick, callback) => {
    const validation = validateNick(nick);
    if (!validation.valid) return callback({ success: false, error: validation.error });

    nick = nick.trim();
    const session = createSession(socket.id, nick);
    socket.join(session.code);
    callback({ success: true, code: session.code, isHost: true, version: VERSION });
    io.to(session.code).emit('player-list', getPlayerList(session));
    console.log(`[${session.code}] Sesja utworzona przez: ${nick}`);
  });

  // Dołączanie do sesji
  socket.on('join-session', (data, callback) => {
    if (!data || !data.nick || !data.code) {
      return callback({ success: false, error: 'Nick i kod sesji są wymagane.' });
    }

    const validation = validateNick(data.nick);
    if (!validation.valid) return callback({ success: false, error: validation.error });

    const nick = data.nick.trim();
    const code = data.code.trim().toUpperCase();

    const session = sessions.get(code);
    if (!session) {
      return callback({ success: false, error: 'Sesja nie istnieje.' });
    }

    if (session.gameStarted) {
      return callback({ success: false, error: 'Runda trwa. Poczekaj na zakończenie.' });
    }

    // Sprawdź duplikat nicku w sesji
    for (const [id, player] of session.players) {
      if (player.nick.toLowerCase() === nick.toLowerCase() && id !== socket.id) {
        return callback({ success: false, error: 'Nick jest już zajęty w tej sesji.' });
      }
    }

    session.players.set(socket.id, { nick, isHost: false });
    socket.join(code);
    callback({ success: true, code, isHost: false, version: VERSION });
    io.to(code).emit('player-list', getPlayerList(session));
    console.log(`[${code}] Dołączył: ${nick}`);
  });

  socket.on('start-game', () => {
    const session = getSessionByPlayer(socket.id);
    if (!session) return;

    const player = session.players.get(socket.id);
    if (!player || !player.isHost) return;
    if (session.gameStarted) return;
    if (session.players.size < 2) {
      socket.emit('error-msg', 'Potrzeba minimum 2 graczy.');
      return;
    }

    session.gameStarted = true;

    const playerIds = Array.from(session.players.keys());
    const firstHolder = playerIds[Math.floor(Math.random() * playerIds.length)];
    session.currentHolder = firstHolder;

    const duration = getRandomTimer();
    console.log(`[${session.code}] Runda rozpoczęta. Pierwszy: ${session.players.get(firstHolder).nick}`);

    startExplosionTimer(session, duration);

    io.to(session.code).emit('game-started', {
      holderId: firstHolder,
      holderNick: session.players.get(firstHolder).nick,
    });
  });

  socket.on('throw-laptop', () => {
    const session = getSessionByPlayer(socket.id);
    if (!session) return;
    if (!session.gameStarted) return;
    if (session.currentHolder !== socket.id) return;

    const now = Date.now();
    const lastThrow = session.lastThrowTime.get(socket.id) || 0;
    if (now - lastThrow < THROW_COOLDOWN_MS) {
      socket.emit('throw-rejected');
      return;
    }
    session.lastThrowTime.set(socket.id, now);

    const newHolder = getRandomPlayer(session, socket.id);
    if (!newHolder) return;

    session.currentHolder = newHolder;

    const newHolderPlayer = session.players.get(newHolder);
    console.log(`[${session.code}] Rzut: ${session.players.get(socket.id).nick} -> ${newHolderPlayer.nick}`);
    io.to(session.code).emit('laptop-thrown', {
      fromId: socket.id,
      fromNick: session.players.get(socket.id).nick,
      toId: newHolder,
      toNick: newHolderPlayer.nick,
    });
  });

  socket.on('cancel-round', () => {
    const session = getSessionByPlayer(socket.id);
    if (!session) return;
    const player = session.players.get(socket.id);
    if (!player || !player.isHost) return;
    if (!session.gameStarted) return;

    cancelRound(session, 'Host anulował rundę.');
  });

  socket.on('window-minimized', () => {
    const session = getSessionByPlayer(socket.id);
    if (!session) return;
    const player = session.players.get(socket.id);
    if (!player) return;
    if (!session.gameStarted) return;

    cancelRound(session, `${player.nick} oszukuje i zmniejszył rozmiar okna`);
  });

  socket.on('disconnect', () => {
    const session = getSessionByPlayer(socket.id);
    if (!session) return;

    const player = session.players.get(socket.id);
    if (!player) return;

    console.log(`[${session.code}] Rozłączono: ${player.nick}`);

    const wasHost = player.isHost;
    const wasHolder = session.currentHolder === socket.id;

    session.players.delete(socket.id);
    session.lastThrowTime.delete(socket.id);

    // Jeśli nie ma graczy — usuń sesję
    if (session.players.size === 0) {
      clearTimeout(session.timer);
      sessions.delete(session.code);
      console.log(`[${session.code}] Sesja usunięta (brak graczy).`);
      return;
    }

    // Jeśli host się rozłączył, wyznacz nowego
    if (wasHost) {
      const firstPlayer = session.players.entries().next().value;
      if (firstPlayer) {
        firstPlayer[1].isHost = true;
        io.to(firstPlayer[0]).emit('you-are-host');
      }
    }

    // Jeśli posiadacz laptopa się rozłączył w trakcie gry
    if (wasHolder && session.gameStarted) {
      cancelRound(session, `Runda przerwana — ${player.nick} rozłączył się.`);
    }

    // Za mało graczy
    if (session.gameStarted && session.players.size < 2) {
      cancelRound(session, 'Runda przerwana — za mało graczy.');
    }

    io.to(session.code).emit('player-list', getPlayerList(session));
  });
});

function validateNick(nick) {
  if (!nick || typeof nick !== 'string') {
    return { valid: false, error: 'Nick jest wymagany.' };
  }
  nick = nick.trim();
  if (nick.length < 1 || nick.length > 20) {
    return { valid: false, error: 'Nick musi mieć od 1 do 20 znaków.' };
  }
  if (!/^[a-zA-Z0-9ąćęłńóśźżĄĆĘŁŃÓŚŹŻ _\-]+$/.test(nick)) {
    return { valid: false, error: 'Nick zawiera niedozwolone znaki.' };
  }
  return { valid: true };
}

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
  console.log(`Serwer działa na porcie ${PORT} (v${VERSION})`);
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
