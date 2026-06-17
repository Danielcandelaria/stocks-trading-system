// stocks/tg.mjs
// Helper compartido de Telegram con soporte MULTI-DESTINATARIO.
// Lee telegram.json: { token, chatId, chatIds:[...] }. Envía a todos los
// destinatarios (chatId + chatIds, deduplicados). Un fallo a un chat no
// bloquea a los demás.

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const CFG = join(dirname(fileURLToPath(import.meta.url)), 'telegram.json');

function recipients(tg) {
  const ids = new Set();
  if (tg?.chatId != null) ids.add(tg.chatId);
  for (const c of tg?.chatIds || []) if (c != null) ids.add(c);
  return [...ids];
}

export async function tgSend(text) {
  if (!existsSync(CFG)) return;
  const tg = JSON.parse(readFileSync(CFG));
  if (!tg?.token) return;
  for (const chat_id of recipients(tg)) {
    try {
      await fetch(`https://api.telegram.org/bot${tg.token}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id, text, parse_mode: 'HTML' }),
      });
    } catch { /* un chat caído no frena a los demás */ }
  }
}
