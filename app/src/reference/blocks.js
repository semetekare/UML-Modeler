// Рендерер блоков статьи.
//
// Блоки приходят из build-reference.mjs уже разобранными: markdown в браузере
// не разбирается — он ломается на 61 блоке ASCII-арта метамодели. Здесь только
// раскладка по классам прототипа (material/reference-prototype/index.html):
// p, ul, note, ocl, text (моноширинный), table, kv.

import { el } from '../util.js';

const CLAUSE = /\b(\d{1,2}(?:\.\d{1,4}){1,4})\b/g;

/**
 * Разметка внутри абзаца: **жирный**, `код`, номера пунктов стандарта.
 * Номер становится ссылкой, только если такой пункт есть в дереве: иначе
 * «UML 2.5.1» и «рис. 4.3.6» превратились бы в битые ссылки.
 */
export function inline(text, ctx = {}) {
  const out = document.createDocumentFragment();
  const src = String(text ?? '');
  let last = 0;
  const re = /(\*\*[^*]+\*\*)|(`[^`]+`)/g;
  let m;
  const pushText = (s) => {
    if (!s) return;
    CLAUSE.lastIndex = 0;
    let at = 0;
    let c;
    while ((c = CLAUSE.exec(s))) {
      if (c.index > at) out.append(document.createTextNode(s.slice(at, c.index)));
      const num = c[1];
      if (ctx.hasClause && ctx.hasClause(num)) {
        out.append(el('a', {
          class: 'cref',
          href: `#${num}`,
          title: `Пункт ${num} стандарта`,
          onclick: (e) => { e.preventDefault(); ctx.openClause?.(num); },
        }, num));
      } else {
        out.append(document.createTextNode(num));
      }
      at = c.index + c[0].length;
    }
    if (at < s.length) out.append(document.createTextNode(s.slice(at)));
  };
  while ((m = re.exec(src))) {
    pushText(src.slice(last, m.index));
    if (m[1]) out.append(el('b', { text: m[1].slice(2, -2) }));
    else out.append(el('code', { text: m[2].slice(1, -1) }));
    last = m.index + m[0].length;
  }
  pushText(src.slice(last));
  return out;
}

function table(block, ctx) {
  const node = el('table', { class: 'doc-table' });
  if (block.head?.length) {
    const head = el('thead');
    const tr = el('tr');
    for (const cell of block.head) tr.append(el('th', {}, inline(cell, ctx)));
    head.append(tr);
    node.append(head);
  }
  if (block.rows?.length) {
    const body = el('tbody');
    for (const row of block.rows) {
      const tr = el('tr');
      for (const cell of row) tr.append(el('td', {}, inline(cell, ctx)));
      body.append(tr);
    }
    node.append(body);
  }
  return node;
}

function constraint(block, ctx) {
  const box = el('div', { class: 'kv', id: `c-${block.name}` });
  box.append(el('div', { class: 'kv-name', text: block.name }));
  if (block.text) box.append(el('p', { class: 'kv-text' }, inline(block.text, ctx)));
  else box.append(el('p', { class: 'kv-text oclnone', text: 'Текст констрейнта в стандарте отсутствует — только OCL.' }));
  if (block.ocl) box.append(el('pre', { class: 'kv-ocl', text: block.ocl }));
  const check = el('div', { class: 'kv-check' });
  if (block.rule) {
    check.append(el('span', { text: 'проверяется: ' }));
    check.append(el('button', {
      class: 'chip',
      type: 'button',
      title: 'Открыть правило',
      onclick: () => ctx.openRule?.(block.rule),
    }, block.rule));
    check.append(el('span', { text: `· ${block.level ?? 'error'}` }));
  } else {
    // Причина — из docs/RULES-SOURCE.md (таблица отказов, поле why в блоке):
    // «этого нет среди 23 правил» отвечает не на тот вопрос, который возникает
    // у человека, — почему правило не проверяется.
    const why = block.why ? String(block.why) : 'этого констрейнта нет среди 23 правил движка';
    check.append(el('span', {
      text: `не проверяется: ${why.charAt(0).toLowerCase()}${why.slice(1)}`,
      title: 'docs/RULES-SOURCE.md: чего не хватает модели uml-model/3, чтобы проверить этот констрейнт',
    }));
  }
  box.append(check);
  return box;
}

/** Все блоки статьи по порядку. */
export function renderBlocks(host, blocks, ctx = {}) {
  for (const b of blocks ?? []) {
    switch (b.t) {
      case 'p':
        host.append(el('p', {}, inline(b.text, ctx)));
        break;
      case 'ul': {
        const ul = el('ul');
        for (const item of b.items ?? []) ul.append(el('li', {}, inline(item, ctx)));
        host.append(ul);
        break;
      }
      case 'note': {
        const note = el('div', { class: 'note' });
        if (b.label) note.append(el('b', { text: b.label }));
        note.append(document.createTextNode(b.text ?? ''));
        host.append(note);
        break;
      }
      case 'ocl':
        host.append(el('pre', { class: 'ocl', text: b.text }));
        break;
      case 'text':
        host.append(el('pre', { class: 'ascii', text: b.text }));
        break;
      case 'table':
        host.append(table(b, ctx));
        break;
      case 'kv':
        host.append(constraint(b, ctx));
        break;
      default:
        break;
    }
  }
}
