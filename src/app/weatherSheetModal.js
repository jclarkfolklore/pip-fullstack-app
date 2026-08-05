// Weather art preview — every condition the API can report, animating, beside
// the WMO codes that resolve to it.
//
// Two jobs. The obvious one is seeing the art move without waiting for the
// weather to change. The more useful one is COVERAGE: Open-Meteo returns raw
// WMO codes 0-99, we collapse them into eight art kinds, and this is where you
// can see that mapping in full and catch a kind with no art or a code with no
// home. The code list is fetched from the server (/api/weather/codes) rather
// than duplicated here — a client-side copy could drift and would then show a
// mapping that isn't the one actually in use.

import { h } from '../lib/dom.js';
import { renderWeatherArt, WEATHER_KINDS } from '../lib/weatherArt.js';
import { weatherCodes } from '../api/weatherRepo.js';
import { openModal } from './modal.js';

function kindCard(kind, codes) {
  const list = codes.length
    ? codes.map((c) => h('span', { class: 'pip-wx-code' }, `${c.code} ${c.label}`))
    : [h('span', { class: 'pip-ticket-empty' }, 'No upstream code maps here')];

  return h('div', { class: 'pip-wx-preview-card', dataset: { orphan: codes.length ? 'false' : 'true' } }, [
    h('div', { class: 'pip-wx-preview-art' }, [renderWeatherArt(kind, { className: 'pip-wx-art--lg' })]),
    h('div', { class: 'pip-wx-preview-meta' }, [
      h('div', { class: 'pip-wx-preview-kind' }, kind.toUpperCase()),
      h('div', { class: 'pip-wx-preview-count' }, `${codes.length} code${codes.length === 1 ? '' : 's'}`),
      h('div', { class: 'pip-wx-preview-codes' }, list)
    ])
  ]);
}

export function openWeatherSheetModal() {
  const body = h('div', { class: 'pip-wx-preview' }, [h('div', { class: 'pip-ticket-empty' }, 'Loading codes…')]);
  const note = h('div', { class: 'pip-modal-note' }, '');

  openModal({
    title: 'WEATHER — ART & CODES',
    body,
    footer: note
  });

  weatherCodes()
    .then(({ byKind, total }) => {
      body.innerHTML = '';

      // Kinds with art but no code can never appear; codes whose kind has no
      // art would render as the fallback. Both are worth seeing.
      const artless = Object.keys(byKind).filter((k) => !WEATHER_KINDS.includes(k));
      const covered = WEATHER_KINDS.reduce((n, k) => n + (byKind[k] || []).length, 0);

      for (const kind of WEATHER_KINDS) body.appendChild(kindCard(kind, byKind[kind] || []));
      for (const kind of artless) body.appendChild(kindCard(kind, byKind[kind]));

      const problems = [];
      if (artless.length) problems.push(`${artless.length} kind(s) with no art: ${artless.join(', ')}`);
      if (covered !== total) problems.push(`${total - covered} code(s) map to a kind with no art`);

      note.textContent = problems.length
        ? `⚠ ${problems.join(' · ')}`
        : `All ${total} upstream WMO codes map to one of ${WEATHER_KINDS.length} drawn conditions.`;
    })
    .catch((err) => {
      body.innerHTML = '';
      body.appendChild(h('div', { class: 'pip-ticket-empty' }, `Couldn't load codes: ${err.message}`));
    });
}
