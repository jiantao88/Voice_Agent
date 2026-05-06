class ConversationBuffer {
  constructor(maxTurns = 6) {
    this.turns = [];
    this.maxTurns = maxTurns;
  }

  addTurn(role, text) {
    this.turns.push({ role, text, ts: Date.now() });
    if (this.turns.length > this.maxTurns) this.turns.shift();
  }

  getRecentContext(n = 3) {
    const recent = this.turns.slice(-n * 2);
    if (recent.length === 0) return '';
    return recent.map(t => `${t.role === 'user' ? '面试者' : 'AI助手'}: ${t.text.substring(0, 300)}`).join('\n');
  }

  getSearchHint() {
    const userTurns = this.turns.filter(t => t.role === 'user').slice(-2);
    if (userTurns.length === 0) return '';
    const combined = userTurns.map(t => t.text).join(' ');
    const keywords = combined
      .replace(/[^一-鿿\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 1)
      .slice(-8);
    return keywords.join(' ');
  }

  clear() {
    this.turns = [];
  }
}

export const conversationBuffer = new ConversationBuffer();
