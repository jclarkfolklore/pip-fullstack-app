import { h } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { THEMES, getTheme, setTheme, themeLabel, onThemeChange } from '../../lib/theme.js';

export const kind = 'settings';

export async function renderTile(ctx) {
  return h(
    'button',
    { class: 'pip-tile', dataset: { widget: 'settings' }, onClick: (e) => ctx.open('settings', e.currentTarget) },
    [
      icon('theme', { size: 20, className: 'pip-tile-icon' }),
      h('div', { class: 'pip-tile-sub' }, `${themeLabel(getTheme())} theme`),
      h('div', { class: 'pip-tile-label' }, 'SETTINGS')
    ]
  );
}

export function renderFull(ctx) {
  const el = h('div', { class: 'pip-view' }, [
    h('div', { class: 'pip-view-header' }, [
      h('button', { class: 'pip-back', onClick: ctx.goHome }, [icon('back', { size: 12 }), ' HOME']),
      h('div', { class: 'pip-view-title' }, 'SETTINGS')
    ])
  ]);
  const body = h('div', { class: 'pip-view-body pip-card-list' });
  el.appendChild(body);

  function render() {
    body.innerHTML = '';

    const themeButtons = THEMES.map((name) =>
      h(
        'button',
        {
          class: `pip-action-btn ${getTheme() === name ? 'pip-action-btn--primary' : 'pip-action-btn--ghost'}`,
          onClick: () => {
            setTheme(name);
            render();
          }
        },
        themeLabel(name)
      )
    );

    body.append(
      h('div', { class: 'pip-card' }, [
        h('div', { class: 'pip-card-top' }, [h('div', { class: 'pip-card-title' }, 'Appearance')]),
        h('div', { class: 'pip-card-actions' }, themeButtons)
      ]),
      h('div', { class: 'pip-card' }, [
        h('div', { class: 'pip-card-top' }, [h('div', { class: 'pip-card-title' }, 'Backup')]),
        h('div', { class: 'pip-card-actions' }, [
          h('a', { class: 'pip-action-btn pip-action-btn--primary', href: '/api/export' }, 'EXPORT BACKUP .sqlite')
        ])
      ])
    );
  }

  render();
  const unsubscribe = onThemeChange(render);
  return { el, destroy: unsubscribe };
}
