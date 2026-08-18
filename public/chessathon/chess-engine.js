/* Toyota Chess inline rules engine: standalone, no network dependency. */
class Chess {
  constructor(fen) {
    this._startFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    this.load(fen || this._startFen);
  }

  load(fen) {
    const parts = String(fen || '').trim().split(/\s+/);
    if (parts.length < 4) return false;
    const rows = parts[0].split('/');
    if (rows.length !== 8) return false;
    const board = Array.from({ length: 8 }, () => Array(8).fill(null));
    for (let r = 0; r < 8; r++) {
      let c = 0;
      for (const ch of rows[r]) {
        if (/\d/.test(ch)) c += Number(ch);
        else {
          if (c > 7 || !/[prnbqkPRNBQK]/.test(ch)) return false;
          board[r][c++] = { type: ch.toLowerCase(), color: ch === ch.toUpperCase() ? 'w' : 'b' };
        }
      }
      if (c !== 8) return false;
    }
    this._board = board;
    this._turn = parts[1] === 'b' ? 'b' : 'w';
    this._castling = parts[2] && parts[2] !== '-' ? parts[2] : '';
    this._ep = parts[3] && parts[3] !== '-' ? parts[3] : null;
    this._half = Number(parts[4] || 0);
    this._full = Number(parts[5] || 1);
    this._history = [];
    this._sanHistory = [];
    this._positionHistory = [this._positionKey()];
    return true;
  }

  board() { return this._board.map(row => row.map(p => p ? { type: p.type, color: p.color } : null)); }
  turn() { return this._turn; }
  get(square) { const pos = this._toRC(square); if (!pos) return null; const p = this._board[pos.r][pos.c]; return p ? { type: p.type, color: p.color } : null; }

  fen() {
    const rows = [];
    for (let r = 0; r < 8; r++) {
      let out = '', empty = 0;
      for (let c = 0; c < 8; c++) {
        const p = this._board[r][c];
        if (!p) empty++;
        else { if (empty) { out += empty; empty = 0; } const ch = p.type; out += p.color === 'w' ? ch.toUpperCase() : ch; }
      }
      if (empty) out += empty; rows.push(out);
    }
    return `${rows.join('/')} ${this._turn} ${this._castling || '-'} ${this._ep || '-'} ${this._half} ${this._full}`;
  }

  moves(options = {}) {
    const square = options && options.square ? options.square : null;
    const verbose = !!(options && options.verbose);
    const legal = this._generateLegalMoves(square);
    if (verbose) return legal.map(m => ({ ...m }));
    return legal.map(m => m.san);
  }

  move(input) {
    if (!input) return null;
    let from, to, promotion;
    if (typeof input === 'string') {
      const match = this._generateLegalMoves().find(m => m.san === input || this._uci(m) === input.toLowerCase());
      if (!match) return null;
      from = match.from; to = match.to; promotion = match.promotion;
    } else { from = input.from; to = input.to; promotion = input.promotion; }
    const legal = this._generateLegalMoves(from).filter(m => m.to === to);
    let chosen = legal.find(m => (m.promotion || null) === (promotion || null));
    if (!chosen && legal.length && legal.every(m => m.promotion)) chosen = legal.find(m => m.promotion === 'q') || legal[0];
    if (!chosen) return null;
    const snapshot = this._snapshot(); this._history.push(snapshot);
    const sanBase = this._sanBase(chosen, legal); this._applyMove(chosen);
    const givesCheck = this.in_check(); const givesMate = givesCheck && this._generateLegalMoves().length === 0;
    chosen.san = sanBase + (givesMate ? '#' : givesCheck ? '+' : ''); this._sanHistory.push(chosen.san); this._positionHistory.push(this._positionKey());
    return { ...chosen };
  }

  undo() { if (!this._history.length) return null; const snap = this._history.pop(); const lastSan = this._sanHistory.pop() || null; if (this._positionHistory.length > 1) this._positionHistory.pop(); this._restore(snap); return lastSan; }
  in_check() { const king = this._findKing(this._turn); return king ? this._isAttacked(king.r, king.c, this._opp(this._turn)) : false; }
  in_checkmate() { return this.in_check() && this._generateLegalMoves().length === 0; }
  in_stalemate() { return !this.in_check() && this._generateLegalMoves().length === 0; }
  in_threefold_repetition() { const key = this._positionKey(); let n = 0; for (const k of this._positionHistory) if (k === key) n++; return n >= 3; }
  insufficient_material() {
    const pieces = [];
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) { const p = this._board[r][c]; if (p && p.type !== 'k') pieces.push({ ...p, r, c }); }
    if (pieces.length === 0) return true;
    if (pieces.length === 1 && (pieces[0].type === 'b' || pieces[0].type === 'n')) return true;
    if (pieces.every(p => p.type === 'b')) { const colors = new Set(pieces.map(p => (p.r + p.c) % 2)); return colors.size === 1; }
    return false;
  }
  in_draw() { return this.in_stalemate() || this.insufficient_material() || this.in_threefold_repetition() || this._half >= 100; }
  game_over() { return this.in_checkmate() || this.in_draw(); }
  pgn() { const chunks = []; for (let i = 0; i < this._sanHistory.length; i += 2) chunks.push(`${Math.floor(i / 2) + 1}. ${this._sanHistory[i]}${this._sanHistory[i + 1] ? ' ' + this._sanHistory[i + 1] : ''}`); return chunks.join(' '); }

  _generateLegalMoves(square) {
    const pseudo = this._generatePseudoMoves(square), color = this._turn, out = [];
    for (const m of pseudo) { const snap = this._snapshot(); this._applyMove(m, true); const king = this._findKing(color); const illegal = king ? this._isAttacked(king.r, king.c, this._opp(color)) : true; this._restore(snap); if (!illegal) out.push(m); }
    for (const m of out) m.san = this._sanBase(m, out); return out;
  }

  _generatePseudoMoves(square) {
    const only = square ? this._toRC(square) : null; if (square && !only) return []; const moves = [];
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      if (only && (r !== only.r || c !== only.c)) continue;
      const p = this._board[r][c]; if (!p || p.color !== this._turn) continue; const from = this._fromRC(r, c);
      if (p.type === 'p') this._pawnMoves(moves, r, c, p, from);
      else if (p.type === 'n') this._jumpMoves(moves, r, c, p, from, [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]);
      else if (p.type === 'b') this._slideMoves(moves, r, c, p, from, [[-1,-1],[-1,1],[1,-1],[1,1]]);
      else if (p.type === 'r') this._slideMoves(moves, r, c, p, from, [[-1,0],[1,0],[0,-1],[0,1]]);
      else if (p.type === 'q') this._slideMoves(moves, r, c, p, from, [[-1,-1],[-1,1],[1,-1],[1,1],[-1,0],[1,0],[0,-1],[0,1]]);
      else if (p.type === 'k') { this._jumpMoves(moves, r, c, p, from, [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]); this._castleMoves(moves, r, c, p, from); }
    }
    return moves;
  }

  _pawnMoves(moves, r, c, p, from) {
    const dir = p.color === 'w' ? -1 : 1, start = p.color === 'w' ? 6 : 1, promoRow = p.color === 'w' ? 0 : 7, one = r + dir;
    if (this._inside(one, c) && !this._board[one][c]) { this._addPawnMove(moves, from, one, c, p, 'n', null, promoRow); const two = r + dir * 2; if (r === start && !this._board[two][c]) this._push(moves, from, two, c, p, 'b'); }
    for (const dc of [-1, 1]) { const nr = r + dir, nc = c + dc; if (!this._inside(nr, nc)) continue; const target = this._board[nr][nc], to = this._fromRC(nr, nc); if (target && target.color !== p.color) this._addPawnMove(moves, from, nr, nc, p, 'c', target.type, promoRow); else if (this._ep === to) this._push(moves, from, nr, nc, p, 'e', 'p'); }
  }
  _addPawnMove(moves, from, r, c, p, flag, captured, promoRow) { if (r === promoRow) for (const promotion of ['q','r','b','n']) this._push(moves, from, r, c, p, flag + 'p', captured, promotion); else this._push(moves, from, r, c, p, flag, captured); }
  _jumpMoves(moves, r, c, p, from, deltas) { for (const [dr, dc] of deltas) { const nr = r + dr, nc = c + dc; if (!this._inside(nr, nc)) continue; const target = this._board[nr][nc]; if (!target) this._push(moves, from, nr, nc, p, 'n'); else if (target.color !== p.color) this._push(moves, from, nr, nc, p, 'c', target.type); } }
  _slideMoves(moves, r, c, p, from, dirs) { for (const [dr, dc] of dirs) { let nr = r + dr, nc = c + dc; while (this._inside(nr, nc)) { const target = this._board[nr][nc]; if (!target) this._push(moves, from, nr, nc, p, 'n'); else { if (target.color !== p.color) this._push(moves, from, nr, nc, p, 'c', target.type); break; } nr += dr; nc += dc; } } }
  _castleMoves(moves, r, c, p, from) {
    const homeRow = p.color === 'w' ? 7 : 0; if (r !== homeRow || c !== 4) return; const enemy = this._opp(p.color); if (this._isAttacked(r, 4, enemy)) return; const kFlag = p.color === 'w' ? 'K' : 'k', qFlag = p.color === 'w' ? 'Q' : 'q';
    if (this._castling.includes(kFlag) && !this._board[r][5] && !this._board[r][6]) { const rook = this._board[r][7]; if (rook && rook.type === 'r' && rook.color === p.color && !this._isAttacked(r,5,enemy) && !this._isAttacked(r,6,enemy)) this._push(moves, from, r, 6, p, 'k'); }
    if (this._castling.includes(qFlag) && !this._board[r][1] && !this._board[r][2] && !this._board[r][3]) { const rook = this._board[r][0]; if (rook && rook.type === 'r' && rook.color === p.color && !this._isAttacked(r,3,enemy) && !this._isAttacked(r,2,enemy)) this._push(moves, from, r, 2, p, 'q'); }
  }
  _push(moves, from, r, c, p, flags, captured, promotion) { moves.push({ color: p.color, from, to: this._fromRC(r,c), flags, piece: p.type, captured, promotion, san: '' }); }
  _applyMove(m) {
    const a = this._toRC(m.from), b = this._toRC(m.to), piece = this._board[a.r][a.c], target = this._board[b.r][b.c]; this._board[a.r][a.c] = null;
    if (m.flags.includes('e')) this._board[b.r + (piece.color === 'w' ? 1 : -1)][b.c] = null;
    this._board[b.r][b.c] = { type: m.promotion || piece.type, color: piece.color };
    if (m.flags.includes('k')) { this._board[b.r][5] = this._board[b.r][7]; this._board[b.r][7] = null; } else if (m.flags.includes('q')) { this._board[b.r][3] = this._board[b.r][0]; this._board[b.r][0] = null; }
    if (piece.type === 'k') this._castling = piece.color === 'w' ? this._castling.replace(/[KQ]/g, '') : this._castling.replace(/[kq]/g, '');
    if (piece.type === 'r') this._removeRookRight(m.from); if (target && target.type === 'r') this._removeRookRight(m.to);
    this._ep = null; if (piece.type === 'p' && Math.abs(a.r - b.r) === 2) this._ep = this._fromRC((a.r + b.r) / 2, a.c);
    this._half = (piece.type === 'p' || target || m.flags.includes('e')) ? 0 : this._half + 1; if (piece.color === 'b') this._full++; this._turn = this._opp(this._turn);
  }
  _removeRookRight(square) { if (square === 'a1') this._castling = this._castling.replace('Q',''); else if (square === 'h1') this._castling = this._castling.replace('K',''); else if (square === 'a8') this._castling = this._castling.replace('q',''); else if (square === 'h8') this._castling = this._castling.replace('k',''); }
  _isAttacked(r, c, by) {
    const pawnDir = by === 'w' ? -1 : 1, pawnSourceR = r - pawnDir;
    for (const dc of [-1,1]) { const sc = c - dc; if (this._inside(pawnSourceR, sc)) { const p = this._board[pawnSourceR][sc]; if (p && p.color === by && p.type === 'p') return true; } }
    for (const [dr,dc] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) { const nr=r+dr,nc=c+dc; if (this._inside(nr,nc)) { const p=this._board[nr][nc]; if (p&&p.color===by&&p.type==='n') return true; } }
    for (const [dr,dc,types] of [[-1,-1,'bq'],[-1,1,'bq'],[1,-1,'bq'],[1,1,'bq'],[-1,0,'rq'],[1,0,'rq'],[0,-1,'rq'],[0,1,'rq']]) { let nr=r+dr,nc=c+dc; while(this._inside(nr,nc)) { const p=this._board[nr][nc]; if(p){ if(p.color===by&&types.includes(p.type)) return true; break; } nr+=dr; nc+=dc; } }
    for (let dr=-1;dr<=1;dr++) for(let dc=-1;dc<=1;dc++) if(dr||dc){ const nr=r+dr,nc=c+dc; if(this._inside(nr,nc)){ const p=this._board[nr][nc]; if(p&&p.color===by&&p.type==='k') return true; } }
    return false;
  }
  _findKing(color) { for (let r=0;r<8;r++) for(let c=0;c<8;c++) { const p=this._board[r][c]; if(p&&p.color===color&&p.type==='k') return {r,c}; } return null; }
  _sanBase(m, legalMoves) {
    if (m.flags.includes('k')) return 'O-O'; if (m.flags.includes('q')) return 'O-O-O'; const capture = m.flags.includes('c') || m.flags.includes('e'); let s = '';
    if (m.piece !== 'p') { s += m.piece.toUpperCase(); const competing = (legalMoves || []).filter(x => x !== m && x.piece === m.piece && x.to === m.to && x.from !== m.from); if (competing.length) { const sameFile = competing.some(x => x.from[0] === m.from[0]), sameRank = competing.some(x => x.from[1] === m.from[1]); if (!sameFile) s += m.from[0]; else if (!sameRank) s += m.from[1]; else s += m.from; } } else if (capture) s += m.from[0];
    if (capture) s += 'x'; s += m.to; if (m.promotion) s += '=' + m.promotion.toUpperCase(); return s;
  }
  _snapshot() { return { board: this._board.map(row => row.map(p => p ? { ...p } : null)), turn: this._turn, castling: this._castling, ep: this._ep, half: this._half, full: this._full }; }
  _restore(s) { this._board = s.board.map(row => row.map(p => p ? { ...p } : null)); this._turn = s.turn; this._castling = s.castling; this._ep = s.ep; this._half = s.half; this._full = s.full; }
  _positionKey() { return this.fen().split(' ').slice(0,4).join(' '); }
  _uci(m) { return m.from + m.to + (m.promotion || ''); }
  _opp(c) { return c === 'w' ? 'b' : 'w'; }
  _inside(r,c) { return r>=0&&r<8&&c>=0&&c<8; }
  _toRC(s) { if (!/^[a-h][1-8]$/.test(String(s || ''))) return null; return { r: 8 - Number(s[1]), c: s.charCodeAt(0) - 97 }; }
  _fromRC(r,c) { return String.fromCharCode(97+c) + (8-r); }
}
