// heartbeat.mjs — cuándo corrió cada escáner y qué encontró.
// Así el panel puede decir "última revisión: hoy 14:02" y sabes que el sistema está vivo.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const F = join(dirname(fileURLToPath(import.meta.url)), 'heartbeat.json');

export function beat(scanner, info = {}) {
  let h = {};
  try { if (existsSync(F)) h = JSON.parse(readFileSync(F, 'utf8')); } catch {}
  h[scanner] = { at: new Date().toISOString(), ...info };
  try { writeFileSync(F, JSON.stringify(h, null, 2)); } catch {}
}

export function readBeats() {
  try { return existsSync(F) ? JSON.parse(readFileSync(F, 'utf8')) : {}; } catch { return {}; }
}
