// ---------- AI (simple minimax + book) ----------
function aiMove() {
  if (gameOver || game.turn() === playerColor) return;
  const key = moveHistory.map(m => m.from + m.to).join('');
  if (OPENING_BOOK[key]) {
    const candidates = OPENING_BOOK[key].filter(uci => { const from = uci.slice(0,2), to = uci.slice(2,4); return game.moves({ verbose: true }).some(m => m.from === from && m.to === to); });
    if (candidates.length) { const uci = candidates[Math.floor(Math.random() * candidates.length)]; doMove(uci.slice(0,2), uci.slice(2,4)); return; }
  }
  const depth = opponent === 'ai1' ? 1 : opponent === 'ai2' ? 2 : 3;
  const best = searchBestMove(depth); if (best) doMove(best.from, best.to, best.promotion);
}
function searchBestMove(depth) {
  const moves = game.moves({ verbose: true }); if (!moves.length) return null;
  moves.sort((a, b) => (b.flags.includes('c') ? 1 : 0) - (a.flags.includes('c') ? 1 : 0));
  let bestScore = -Infinity, bestMoves = [];
  for (const m of moves) { game.move(m); const score = -negamax(depth - 1, -Infinity, Infinity); game.undo(); if (score > bestScore) { bestScore = score; bestMoves = [m]; } else if (score === bestScore) bestMoves.push(m); }
  updateEval(bestScore / 100); return bestMoves[Math.floor(Math.random() * bestMoves.length)];
}
function negamax(depth, alpha, beta) {
  if (depth === 0 || game.game_over()) return evaluate();
  let max = -Infinity; const moves = game.moves({ verbose: true }); moves.sort((a, b) => (b.flags.includes('c') ? 1 : 0) - (a.flags.includes('c') ? 1 : 0));
  for (const m of moves) { game.move(m); const score = -negamax(depth - 1, -beta, -alpha); game.undo(); if (score > max) max = score; if (score > alpha) alpha = score; if (alpha >= beta) break; }
  return max;
}
function evaluate() {
  if (game.in_checkmate()) return game.turn() === 'w' ? -99999 : 99999;
  if (game.in_draw()) return 0;
  let score = 0; const board = game.board();
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) { const p = board[r][c]; if (!p) continue; let v = PIECE_VALUES[p.type]; if (p.type === 'p') v += (p.color === 'w' ? 7 - r : r) * 4; if (p.type === 'n' || p.type === 'b') { const center = 3.5; v += (3.5 - Math.abs(c - center) - Math.abs(r - center)) * 6; } score += p.color === 'w' ? v : -v; }
  score += game.turn() === 'w' ? 10 : -10; return game.turn() === 'w' ? score : -score;
}
function updateEval(score) { const clamped = Math.max(-10, Math.min(10, score)); const pct = 50 + clamped * 5; document.getElementById('evalBar').style.width = pct + '%'; document.getElementById('evalLabel').textContent = score > 0 ? '+' + score.toFixed(1) : score.toFixed(1); }
function formatTime(s) { if (s < 0) s = 0; const m = Math.floor(s / 60), sec = Math.floor(s % 60); return m + ':' + (sec < 10 ? '0' : '') + sec; }
function updateClockDisplay() {
  document.getElementById('timeWhite').textContent = formatTime(whiteTime); document.getElementById('timeBlack').textContent = formatTime(blackTime);
  document.getElementById('clockWhite').classList.toggle('active', clocksRunning && activeColor === 'w'); document.getElementById('clockBlack').classList.toggle('active', clocksRunning && activeColor === 'b');
  document.getElementById('clockWhite').classList.toggle('low', whiteTime < 30); document.getElementById('clockBlack').classList.toggle('low', blackTime < 30);
}
function switchClock() { if (whiteTime <= 0 || blackTime <= 0) return; if (increment > 0) { if (activeColor === 'w') whiteTime += increment; else blackTime += increment; } activeColor = game.turn(); updateClockDisplay(); }
function startClocks() {
  stopClocks(); if (whiteTime <= 0 && blackTime <= 0) return; clocksRunning = true;
  clockInterval = setInterval(() => { if (gameOver) { stopClocks(); return; } if (activeColor === 'w') { whiteTime -= .1; if (whiteTime <= 0) { whiteTime = 0; flag('w'); } } else { blackTime -= .1; if (blackTime <= 0) { blackTime = 0; flag('b'); } } updateClockDisplay(); }, 100);
}
function stopClocks() { clocksRunning = false; if (clockInterval) clearInterval(clockInterval); clockInterval = null; updateClockDisplay(); }
function flag(color) { stopClocks(); gameOver = true; const winner = color === 'w' ? 'Black' : 'White'; showResult('Time forfeit', winner + ' wins on time.'); }
function updateStatus() {
  const el = document.getElementById('status'); let text = '', checking = false;
  if (game.in_checkmate()) text = (game.turn() === 'w' ? 'MIDNIGHT' : 'SILVER') + ' WINS — CHECKMATE';
  else if (game.in_draw()) { if (game.in_stalemate()) text = 'DRAW — STALEMATE'; else if (game.in_threefold_repetition()) text = 'DRAW — REPETITION'; else if (game.insufficient_material()) text = 'DRAW — INSUFFICIENT MATERIAL'; else text = 'DRAW'; }
  else if (game.in_check()) { text = 'TUNDRA IN CHECK.'; checking = true; }
  else text = (game.turn() === 'w' ? 'SILVER' : 'MIDNIGHT') + ' TO MOVE';
  el.textContent = text; el.classList.toggle('in-check', checking);
}
function updateCapturedInventory() {
  const el = document.getElementById('capturedInventory'); if (!el) return; const counts = {};
  for (const m of moveHistory) if (m.captured) counts[m.captured] = (counts[m.captured] || 0) + 1;
  const chips = ['p','n','b','r','q'].filter(t => counts[t]).map(t => '<span class="inventory-chip">' + TOYOTA_MODELS[t].title + ' ×' + counts[t] + '</span>');
  el.innerHTML = chips.length ? chips.join('') : '<span class="inventory-empty">No trade-ins yet.</span>';
}
function updateMoveList() { const el = document.getElementById('moveList'); let html = ''; for (let i = 0; i < moveHistory.length; i++) { if (i % 2 === 0) html += `<span style="color:var(--muted)">${Math.floor(i/2)+1}.</span> `; html += `<span class="mv" data-i="${i}">${moveHistory[i].san}</span> `; } el.innerHTML = html; el.scrollTop = el.scrollHeight; }
function getPGN() {
  const headers = ['[Event "Toyota Chess Arena"]','[Site "GitHub Pages"]','[Date "' + new Date().toISOString().slice(0,10).replace(/-/g,'.') + '"]','[White "' + (playerColor === 'w' ? 'Player' : (opponent.startsWith('ai') ? 'AI' : 'Player')) + '"]','[Black "' + (playerColor === 'b' ? 'Player' : (opponent.startsWith('ai') ? 'AI' : 'Player')) + '"]','[Result "' + (gameOver ? (game.in_checkmate() ? (game.turn()==='w'?'0-1':'1-0') : '1/2-1/2') : '*') + '"]'];
  return headers.join('\n') + '\n\n' + game.pgn() + (gameOver ? '' : ' *');
}
function newGame() {
  stopClocks(); game = new Chess(); selected = null; legalMoves = []; lastMove = null; gameOver = false; historyStack = []; moveHistory = []; pendingPromo = null;
  document.getElementById('promoOverlay').classList.remove('show'); document.getElementById('resultModal').classList.remove('show');
  const tc = document.getElementById('timeControl').value.split('|'), base = parseInt(tc[0], 10) * 60; increment = parseInt(tc[1] || '0', 10); whiteTime = base || 0; blackTime = base || 0; if (base === 0) { whiteTime = 0; blackTime = 0; }
  opponent = document.getElementById('opponent').value; showLegal = document.getElementById('showLegal').value === '1'; let color = document.getElementById('playAs').value; if (color === 'random') color = Math.random() < .5 ? 'w' : 'b'; playerColor = color; flipped = playerColor === 'b'; orientation = playerColor; activeColor = 'w';
  buildBoard(); updateMoveList(); updateCapturedInventory(); updateStatus(); updateClockDisplay(); updateEval(0); if (base > 0) startClocks(); if (opponent.startsWith('ai') && playerColor === 'b') setTimeout(aiMove, 400);
}
function endGame() { stopClocks(); gameOver = true; updateStatus(); let title = 'Game Over', text = document.getElementById('status').textContent; if (game.in_checkmate()) title = (game.turn() === 'w' ? 'Black' : 'White') + ' wins!'; else title = 'Draw'; showResult(title, text); }
function showResult(title, text) { document.getElementById('resultTitle').textContent = title; document.getElementById('resultText').textContent = text; document.getElementById('resultModal').classList.add('show'); }

document.getElementById('btnNew').onclick = () => newGame();
document.getElementById('btnSettings').onclick = () => document.getElementById('settingsModal').classList.add('show');
document.getElementById('btnCancelSettings').onclick = () => document.getElementById('settingsModal').classList.remove('show');
document.getElementById('btnApplySettings').onclick = () => { document.getElementById('settingsModal').classList.remove('show'); newGame(); };
document.getElementById('btnExport').onclick = () => { const pgn = getPGN(); navigator.clipboard.writeText(pgn).then(() => alert('PGN copied to clipboard')).catch(() => prompt('Copy PGN:', pgn)); };
document.getElementById('btnUndo').onclick = () => { if (historyStack.length === 0 || gameOver) return; const snap = historyStack.pop(); game.load(snap.fen); whiteTime = snap.whiteTime; blackTime = snap.blackTime; activeColor = snap.activeColor; lastMove = snap.lastMove; moveHistory = snap.moveHistory; selected = null; legalMoves = []; updateMoveList(); updateCapturedInventory(); updateStatus(); renderPieces(); updateClockDisplay(); };
document.getElementById('btnFlip').onclick = () => { flipped = !flipped; buildBoard(); };
document.getElementById('btnResign').onclick = () => { if (gameOver) return; stopClocks(); gameOver = true; showResult('Resignation', (playerColor === 'w' ? 'Black' : 'White') + ' wins by resignation.'); };
document.getElementById('btnDraw').onclick = () => { if (gameOver) return; if (confirm('Offer / claim draw?')) { stopClocks(); gameOver = true; showResult('Draw', 'Draw agreed.'); } };
document.getElementById('btnRematch').onclick = () => { document.getElementById('resultModal').classList.remove('show'); newGame(); };
document.getElementById('btnCloseResult').onclick = () => document.getElementById('resultModal').classList.remove('show');
document.getElementById('btnSound').onclick = () => { soundEnabled = !soundEnabled; const btn = document.getElementById('btnSound'); btn.textContent = soundEnabled ? 'Sound On' : 'Sound Off'; btn.classList.toggle('utility-on', soundEnabled); btn.setAttribute('aria-pressed', soundEnabled ? 'true' : 'false'); if (soundEnabled) { ensureAudio(); playEngineRev(.55); } };
document.addEventListener('pointerdown', () => { if (soundEnabled) ensureAudio(); }, { once: true });
document.addEventListener('keydown', e => { if (e.key === 'f') { flipped = !flipped; buildBoard(); } });
if (typeof Chess !== 'function') document.body.innerHTML = '<div style="max-width:520px;margin:15vh auto;padding:24px;font-family:-apple-system,sans-serif;color:#fff;background:#1a1d24;border-radius:16px"><h2 style="margin-bottom:12px">Toyota Chess could not start</h2><p style="line-height:1.5;color:#c9cdd3">Toyota Chess could not initialize its built-in chess engine. Reload the page.</p></div>';
else { buildBoard(); newGame(); }
