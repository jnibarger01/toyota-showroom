/* ============================================================
   Toyota Chess Garage — Safari-friendly browser chess
   Core: chess.js rules + Toyota vehicle UI, clocks, PGN, simple AI
   ============================================================ */

const TOYOTA_MODELS = {
  p: { code: 'PRIUS', title: 'Prius' },
  r: { code: '4R', title: '4Runner' },
  n: { code: 'RAV4', title: 'RAV4' },
  b: { code: 'CAMRY', title: 'Camry' },
  q: { code: 'TACO', title: 'Tacoma' },
  k: { code: 'TUNDRA', title: 'Tundra' }
};

const VEHICLE_ART = {"p": "assets/prius.webp", "r": "assets/4runner.webp", "n": "assets/rav4.webp", "b": "assets/camry.webp", "q": "assets/tacoma.webp", "k": "assets/tundra.webp"};

function vehicleArtwork(type, color) {
  const model = TOYOTA_MODELS[type];
  const safeAlt = model ? model.title : 'Toyota vehicle';
  return '<img src="' + VEHICLE_ART[type] + '" alt="' + safeAlt + ' chess piece">' +
         '<span class="team-dot" aria-hidden="true"></span>';
}

const FILES = 'abcdefgh';
const PIECE_VALUES = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };
const OPENING_BOOK = {
  '': ['e2e4', 'd2d4', 'c2c4', 'g1f3'],
  'e2e4': ['e7e5', 'c7c5', 'e7e6', 'c7c6'],
  'e2e4e7e5': ['g1f3', 'f1c4', 'b1c3'],
  'e2e4e7e5g1f3': ['b8c6', 'g8f6'],
  'd2d4': ['d7d5', 'g8f6', 'e7e6'],
  'd2d4d7d5': ['c2c4', 'g1f3'],
};

let game = new Chess();
let selected = null;
let legalMoves = [];
let lastMove = null;
let flipped = false;
let orientation = 'w';
let playerColor = 'w';
let opponent = 'ai2';
let showLegal = true;
let gameOver = false;
let historyStack = [];
let moveHistory = [];
let clockInterval = null;
let whiteTime = 600;
let blackTime = 600;
let increment = 0;
let activeColor = 'w';
let clocksRunning = false;
let pendingPromo = null;

function sqName(r, c) {
  const file = flipped ? 7 - c : c;
  const rank = flipped ? r : 7 - r;
  return FILES[file] + (rank + 1);
}
function parseSq(name) {
  const file = FILES.indexOf(name[0]);
  const rank = parseInt(name[1], 10) - 1;
  const c = flipped ? 7 - file : file;
  const r = flipped ? rank : 7 - rank;
  return { r, c };
}
function buildBoard() {
  const board = document.getElementById('board');
  board.innerHTML = '';
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const sq = document.createElement('div');
      const isLight = (r + c) % 2 === 0;
      sq.className = 'sq ' + (isLight ? 'light' : 'dark');
      sq.dataset.r = r; sq.dataset.c = c;
      const name = sqName(r, c); sq.dataset.sq = name;
      if ((!flipped && r === 7) || (flipped && r === 0)) {
        const f = document.createElement('span'); f.className = 'coords coord-file'; f.textContent = name[0]; sq.appendChild(f);
      }
      if ((!flipped && c === 0) || (flipped && c === 7)) {
        const rk = document.createElement('span'); rk.className = 'coords coord-rank'; rk.textContent = name[1]; sq.appendChild(rk);
      }
      sq.addEventListener('click', onSquareClick);
      sq.addEventListener('dragover', e => e.preventDefault());
      sq.addEventListener('drop', onDrop);
      board.appendChild(sq);
    }
  }
  renderPieces();
}
function renderPieces() {
  document.querySelectorAll('.piece').forEach(p => p.remove());
  document.querySelectorAll('.dot, .capture-ring').forEach(el => el.remove());
  document.querySelectorAll('.sq').forEach(sq => sq.classList.remove('hl-last', 'hl-check'));
  const board = game.board();
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c]; if (!piece) continue;
      const displayR = flipped ? 7 - r : r; const displayC = flipped ? 7 - c : c;
      const sqEl = document.querySelector(`.sq[data-r="${displayR}"][data-c="${displayC}"]`); if (!sqEl) continue;
      const el = document.createElement('div'); el.className = 'piece';
      const model = TOYOTA_MODELS[piece.type];
      const car = document.createElement('div'); car.className = 'vehicle-piece ' + (piece.color === 'w' ? 'white' : 'black');
      car.title = model.title; car.setAttribute('aria-label', (piece.color === 'w' ? 'White ' : 'Black ') + model.title);
      car.innerHTML = vehicleArtwork(piece.type, piece.color); el.appendChild(car);
      el.draggable = !('ontouchstart' in window) && !gameOver && piece.color === game.turn() && (opponent === 'human' || piece.color === playerColor);
      el.dataset.sq = FILES[c] + (8 - r); if (selected === el.dataset.sq) el.classList.add('selected');
      el.addEventListener('dragstart', onDragStart); el.addEventListener('dragend', onDragEnd); sqEl.appendChild(el);
    }
  }
  if (lastMove) [lastMove.from, lastMove.to].forEach(s => { const { r, c } = parseSq(s); const el = document.querySelector(`.sq[data-r="${r}"][data-c="${c}"]`); if (el) el.classList.add('hl-last'); });
  if (game.in_check()) {
    const b = game.board();
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const p = b[r][c]; if (p && p.type === 'k' && p.color === game.turn()) {
        const displayR = flipped ? 7 - r : r, displayC = flipped ? 7 - c : c;
        const el = document.querySelector(`.sq[data-r="${displayR}"][data-c="${displayC}"]`); if (el) el.classList.add('hl-check');
      }
    }
  }
  if (selected && showLegal) legalMoves.forEach(m => {
    const { r, c } = parseSq(m.to); const el = document.querySelector(`.sq[data-r="${r}"][data-c="${c}"]`); if (!el) return;
    const marker = document.createElement('div'); marker.className = (m.flags.includes('c') || m.flags.includes('e')) ? 'capture-ring' : 'dot'; el.appendChild(marker);
  });
}
function onSquareClick(e) {
  if (gameOver) return;
  const sq = e.currentTarget.dataset.sq; const piece = game.get(sq);
  if (selected) {
    const move = legalMoves.find(m => m.to === sq); if (move) { tryMakeMove(selected, sq, move.promotion); return; }
    if (piece && piece.color === game.turn() && (opponent === 'human' || piece.color === playerColor)) { selectSquare(sq); return; }
    deselect();
  } else if (piece && piece.color === game.turn() && (opponent === 'human' || piece.color === playerColor)) selectSquare(sq);
}
function selectSquare(sq) { selected = sq; legalMoves = game.moves({ square: sq, verbose: true }); renderPieces(); }
function deselect() { selected = null; legalMoves = []; renderPieces(); }
function onDragStart(e) {
  if (gameOver) { e.preventDefault(); return; }
  const sq = e.target.dataset.sq; const piece = game.get(sq);
  if (!piece || piece.color !== game.turn() || (opponent !== 'human' && piece.color !== playerColor)) { e.preventDefault(); return; }
  selectSquare(sq); e.target.classList.add('dragging'); e.dataTransfer.setData('text/plain', sq); e.dataTransfer.effectAllowed = 'move';
}
function onDragEnd(e) { e.target.classList.remove('dragging'); }
function onDrop(e) { e.preventDefault(); const from = e.dataTransfer.getData('text/plain'); const to = e.currentTarget.dataset.sq; if (!from) return; const move = legalMoves.find(m => m.to === to); if (move) tryMakeMove(from, to, move.promotion); else deselect(); }
function tryMakeMove(from, to, promotion) {
  const piece = game.get(from);
  if (piece && piece.type === 'p') { const rank = to[1]; if ((piece.color === 'w' && rank === '8') || (piece.color === 'b' && rank === '1')) { if (!promotion) { pendingPromo = { from, to }; showPromotion(piece.color); return; } } }
  doMove(from, to, promotion);
}
function showPromotion(color) {
  const overlay = document.getElementById('promoOverlay'), choices = document.getElementById('promoChoices'); choices.innerHTML = '';
  ['q','r','b','n'].forEach(p => { const btn = document.createElement('button'); btn.textContent = TOYOTA_MODELS[p].title; btn.style.fontSize = '0.72rem'; btn.onclick = () => { overlay.classList.remove('show'); doMove(pendingPromo.from, pendingPromo.to, p); pendingPromo = null; }; choices.appendChild(btn); });
  overlay.classList.add('show');
}
let soundEnabled = true;
let audioCtx = null;
let toastTimer = null;
function ensureAudio() {
  if (!soundEnabled) return null;
  try { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null; if (!audioCtx) audioCtx = new AC(); if (audioCtx.state === 'suspended') audioCtx.resume(); return audioCtx; } catch (_) { return null; }
}
function playEngineRev(power) {
  const ctx = ensureAudio(); if (!ctx || !soundEnabled) return;
  const now = ctx.currentTime, gain = ctx.createGain(), filter = ctx.createBiquadFilter(), osc1 = ctx.createOscillator(), osc2 = ctx.createOscillator();
  filter.type = 'lowpass'; filter.frequency.setValueAtTime(650, now); filter.frequency.exponentialRampToValueAtTime(1600, now + .22);
  osc1.type = 'sawtooth'; osc2.type = 'square'; const p = Math.max(.45, Math.min(1.4, power || .75));
  osc1.frequency.setValueAtTime(58 * p, now); osc1.frequency.exponentialRampToValueAtTime(178 * p, now + .24);
  osc2.frequency.setValueAtTime(116 * p, now); osc2.frequency.exponentialRampToValueAtTime(352 * p, now + .24);
  gain.gain.setValueAtTime(.0001, now); gain.gain.exponentialRampToValueAtTime(.055 * p, now + .035); gain.gain.exponentialRampToValueAtTime(.0001, now + .28);
  osc1.connect(filter); osc2.connect(filter); filter.connect(gain); gain.connect(ctx.destination); osc1.start(now); osc2.start(now); osc1.stop(now + .29); osc2.stop(now + .29);
}
function showToast(message) { const el = document.getElementById('toast'); if (!el) return; clearTimeout(toastTimer); el.textContent = message; el.classList.add('show'); toastTimer = setTimeout(() => el.classList.remove('show'), 1350); }
function prepCaptureGhost(to) { const target = document.querySelector('.piece[data-sq="' + to + '"]'); if (!target) return null; const rect = target.getBoundingClientRect(); return { html: target.innerHTML, rect }; }
function launchCaptureGhost(snapshot, capturedType) {
  if (!snapshot) return;
  const ghost = document.createElement('div'); ghost.className = 'capture-ghost'; ghost.style.left = snapshot.rect.left + 'px'; ghost.style.top = snapshot.rect.top + 'px'; ghost.style.width = snapshot.rect.width + 'px'; ghost.style.height = snapshot.rect.height + 'px'; ghost.innerHTML = snapshot.html; document.body.appendChild(ghost);
  const wrap = document.getElementById('boardWrap'); wrap.classList.remove('capture-impact'); void wrap.offsetWidth; wrap.classList.add('capture-impact'); setTimeout(() => { ghost.remove(); wrap.classList.remove('capture-impact'); }, 460);
  if (capturedType && TOYOTA_MODELS[capturedType]) showToast('TRADE-IN: ' + TOYOTA_MODELS[capturedType].title.toUpperCase() + ' CAPTURED');
}
function doMove(from, to, promotion) {
  const captureGhost = prepCaptureGhost(to);
  historyStack.push({ fen: game.fen(), whiteTime, blackTime, activeColor, lastMove: lastMove ? { ...lastMove } : null, moveHistory: moveHistory.map(m => ({ ...m })) });
  const move = game.move({ from, to, promotion: promotion || undefined }); if (!move) return;
  if (move.captured) launchCaptureGhost(captureGhost, move.captured); playEngineRev(move.captured ? 1.2 : .72);
  lastMove = { from, to }; moveHistory.push({ san: move.san, from, to, fen: game.fen(), captured: move.captured || null, color: move.color }); selected = null; legalMoves = [];
  updateMoveList(); updateCapturedInventory(); updateStatus(); renderPieces(); if (game.in_check()) showToast('TUNDRA IN CHECK.'); switchClock();
  if (game.game_over()) { endGame(); return; }
  if (opponent.startsWith('ai') && game.turn() !== playerColor) setTimeout(aiMove, 250 + Math.random() * 400);
}
