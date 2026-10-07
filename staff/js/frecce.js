// Disegno delle frecce SRM: la freccia rossa in legno con il logo SRM bianco
export const STATI = {
  da_verificare: { label: 'Da verificare', breve: 'Da verificare', colore: '#B7791F', icona: '?' },
  verificato:    { label: 'Posizione confermata', breve: 'Confermato', colore: '#1F5FAD', icona: '✓' },
  posato:        { label: 'Posato', breve: 'Posato', colore: '#3E6B2A', icona: '●' },
  rimosso:       { label: 'Rimosso', breve: 'Rimosso', colore: '#6B6F67', icona: '✕' },
};
export const ORDINE_STATI = ['da_verificare', 'verificato', 'posato', 'rimosso'];

export const DIR_LABEL = { sx: 'a sinistra', dx: 'a destra', dritto: 'dritto' };
export const VERSO_LABEL = { andata: 'andata', ritorno: 'ritorno', unico: '' };

// Freccia "reale" vista dal corridore: sx punta a sinistra, dx a destra, dritto in alto
export function frecciaCartello(dir = 'dx', { h = 56, titolo = '' } = {}) {
  const rosso = '#C62828';
  if (dir === 'dritto') {
    const w = h * 0.62;
    return `<svg class="cartello" role="img" aria-label="${titolo || 'Freccia dritto'}" viewBox="0 0 60 120" width="${w}" height="${h * 1.25}">
      <path d="M30 4 L56 40 L42 40 L42 112 L18 112 L18 40 L4 40 Z" fill="${rosso}" stroke="#7a1414" stroke-width="2" stroke-linejoin="round"/>
      <text x="30" y="80" fill="#fff" font-family="Oswald, sans-serif" font-weight="700" font-size="17" text-anchor="middle" transform="rotate(-90 30 80)">SRM</text>
    </svg>`;
  }
  const verso = dir === 'sx' ? -1 : 1;
  const tr = verso < 0 ? 'transform="translate(160 0) scale(-1 1)"' : '';
  return `<svg class="cartello" role="img" aria-label="${titolo || 'Freccia ' + DIR_LABEL[dir]}" viewBox="0 0 160 64" width="${h * 2.5}" height="${h}">
    <g ${tr}><path d="M6 18 L104 18 L104 4 L154 32 L104 60 L104 46 L6 46 Z" fill="${rosso}" stroke="#7a1414" stroke-width="2" stroke-linejoin="round"/></g>
    <text x="${verso < 0 ? 96 : 62}" y="41" fill="#fff" font-family="Oswald, sans-serif" font-weight="700" font-size="25" letter-spacing="1.5" text-anchor="middle">SRM</text>
  </svg>`;
}

// Freccia per la mappa: punta verso la direzione in cui va il corridore (gradi da nord)
export function frecciaMappa(gradi, { size = 46, sbiadita = false, lettera = '' } = {}) {
  return `<svg class="freccia-mappa" viewBox="-24 -24 48 48" width="${size}" height="${size}" style="opacity:${sbiadita ? 0.4 : 1}">
    <g transform="rotate(${gradi})">
      <path d="M0 -22 L13 -6 L5 -6 L5 18 L-5 18 L-5 -6 L-13 -6 Z" fill="#C62828" stroke="#fff" stroke-width="2.4" stroke-linejoin="round"/>
    </g>
    ${lettera ? `<text x="0" y="4" font-family="Oswald, sans-serif" font-size="11" font-weight="700" fill="#fff" text-anchor="middle" transform="rotate(${gradi}) translate(0 2) rotate(${-gradi})">${lettera}</text>` : ''}
  </svg>`;
}
