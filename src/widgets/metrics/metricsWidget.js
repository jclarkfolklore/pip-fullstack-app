import { h } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { tile } from '../../app/tile.js';
import { onChange } from '../../api/client.js';
import { getMetrics } from '../../api/metricsRepo.js';

export const kind = 'metrics';

export async function renderTile(ctx) {
  const metrics = await getMetrics();
  const total = metrics.last7DaysResolved.reduce((a, d) => a + d.resolved, 0);
  return tile({
    kind: 'metrics',
    glyph: 'metricsLg',
    label: 'METRICS',
    sub: total ? `${total} resolved / 7d` : 'no activity yet',
    ctx
  });
}

function bar(label, value, max) {
  const pct = max > 0 ? Math.max(4, Math.round((value / max) * 100)) : 4;
  return h('div', { class: 'pip-bar-col' }, [
    h('div', { class: 'pip-bar-track' }, [h('div', { class: 'pip-bar-fill', style: `height:${pct}%` })]),
    h('div', { class: 'pip-bar-value' }, String(value)),
    h('div', { class: 'pip-bar-label' }, label)
  ]);
}

function statRow(iconName, label, value) {
  return h('div', { class: 'pip-card' }, [
    h('div', { class: 'pip-card-top' }, [
      h('div', { class: 'pip-card-title', style: 'display:flex;align-items:center;gap:6px;' }, [
        icon(iconName, { size: 12 }),
        label
      ]),
      h('div', { class: 'pip-tile-sub' }, value)
    ])
  ]);
}

export function renderFull(ctx) {
  const el = h('div', { class: 'pip-view' });
  const header = h('div', { class: 'pip-view-header' }, [
    h('button', { class: 'pip-back', onClick: ctx.goHome }, [icon('back', { size: 12 }), ' HOME']),
    h('div', { class: 'pip-view-title' }, 'METRICS')
  ]);
  const body = h('div', { class: 'pip-view-body' });
  el.append(header, body);

  async function render() {
    const m = await getMetrics();
    body.innerHTML = '';

    const days = m.last7DaysResolved.map((d) => ({
      label: new Date(d.day).toLocaleDateString(undefined, { weekday: 'narrow' }),
      n: d.resolved
    }));
    const max = Math.max(1, ...days.map((d) => d.n));
    const chart = h('div', { class: 'pip-bar-chart' }, days.map((d) => bar(d.label, d.n, max)));
    body.appendChild(h('div', { class: 'pip-metrics-section-title' }, 'RESOLVED — LAST 7 DAYS'));
    body.appendChild(chart);

    const avgHours = m.avgResolutionHours;
    body.appendChild(h('div', { class: 'pip-metrics-section-title' }, 'SNAPSHOT'));
    body.appendChild(
      h('div', { class: 'pip-card-list' }, [
        statRow('clock', 'Avg time to resolve (30d)', avgHours == null ? '—' : avgHours < 24 ? `${avgHours.toFixed(1)}h` : `${(avgHours / 24).toFixed(1)}d`),
        statRow('inbox', 'Inbox active', String(m.inbox.active)),
        statRow('tasks', 'Tasks open', String(m.tasks.open + m.tasks.doing)),
        statRow('check', 'Tasks done (all time)', String(m.tasks.done)),
        statRow('note', 'Notes', String(m.notes.total))
      ])
    );

    if (m.byProject.length) {
      body.appendChild(h('div', { class: 'pip-metrics-section-title' }, 'BY PROJECT'));
      body.appendChild(
        h(
          'div',
          { class: 'pip-card-list' },
          m.byProject.map((p) => statRow('folder', p.name, String(p.n)))
        )
      );
    }

    if (m.bySourceType.length) {
      body.appendChild(h('div', { class: 'pip-metrics-section-title' }, 'BY SOURCE'));
      body.appendChild(
        h(
          'div',
          { class: 'pip-card-list' },
          m.bySourceType.map((s) => statRow('link', s.source_type, String(s.n)))
        )
      );
    }

    if (m.topTags.length) {
      body.appendChild(h('div', { class: 'pip-metrics-section-title' }, 'TOP TAGS'));
      body.appendChild(
        h(
          'div',
          { class: 'pip-tag-row' },
          m.topTags.map((t) => h('span', { class: 'pip-tag' }, `#${t.tag} (${t.n})`))
        )
      );
    }
  }

  render();
  const unsubscribe = onChange(render);
  return { el, destroy: unsubscribe };
}
