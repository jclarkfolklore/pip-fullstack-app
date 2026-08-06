// The gate in front of a deployed snapshot.
//
// WHAT THIS IS AND ISN'T. It's front-end only: it keeps the dashboard behind
// a prompt so a shared link doesn't open straight into someone's workspace.
// It is NOT access control — the captured JSON under /api/ is still fetchable
// directly by anyone who knows a URL, and the check runs in the browser where
// it can be bypassed. Treat it as "not for casual eyes", not as security.
//
// What it does do: the password itself is never shipped. The snapshot embeds
// a SHA-256 of it, so the plaintext isn't sitting in the HTML for anyone who
// opens view-source.
//
// Only ever runs for static snapshots. The live local app has no gate.

import { h } from '../lib/dom.js';
import { icon } from '../lib/icons.js';

// Per-tab, so closing it re-locks. Deliberately not localStorage: a shared
// machine shouldn't stay unlocked forever.
const UNLOCK_KEY = 'pip-snapshot-unlocked';

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function alreadyUnlocked(expectedHash) {
  try {
    return sessionStorage.getItem(UNLOCK_KEY) === expectedHash;
  } catch (_) {
    return false;
  }
}

// Resolves once the right password is entered. Styled as the device's own
// screen so it reads as part of the app rather than a browser prompt.
export function showPasswordGate(expectedHash) {
  return new Promise((resolve) => {
    const input = h('input', {
      class: 'pip-gate-input',
      type: 'password',
      placeholder: 'password',
      autocomplete: 'current-password',
      spellcheck: 'false'
    });
    const error = h('div', { class: 'pip-gate-error' }, '');
    const submit = h('button', { class: 'pip-gate-submit', type: 'submit' }, 'ENTER');

    const form = h('form', { class: 'pip-gate-form' }, [
      h('div', { class: 'pip-gate-brand' }, [h('span', { class: 'pip-gate-dot' }), 'PIP']),
      h('div', { class: 'pip-gate-title' }, 'READ-ONLY SNAPSHOT'),
      h('div', { class: 'pip-gate-sub' }, 'Enter the password to view this workspace.'),
      h('div', { class: 'pip-gate-row' }, [input, submit]),
      error
    ]);

    const scrim = h('div', { class: 'pip-gate' }, [
      h('div', { class: 'pip-gate-screen' }, [
        form,
        h('div', { class: 'pip-gate-scanlines' })
      ])
    ]);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const value = input.value;
      if (!value) return;

      submit.disabled = true;
      const ok = (await sha256Hex(value)) === expectedHash;
      submit.disabled = false;

      if (!ok) {
        error.textContent = 'Not quite. Try again.';
        scrim.classList.remove('is-wrong');
        // Reflow so the shake replays on a second wrong attempt.
        void scrim.offsetWidth;
        scrim.classList.add('is-wrong');
        input.select();
        return;
      }

      try {
        sessionStorage.setItem(UNLOCK_KEY, expectedHash);
      } catch (_) {
        /* private browsing — they'll just re-enter it next load */
      }
      scrim.remove();
      resolve();
    });

    document.body.appendChild(scrim);
    input.focus();
  });
}
