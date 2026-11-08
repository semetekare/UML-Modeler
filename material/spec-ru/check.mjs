#!/usr/bin/env node
// Машинная проверка перевода спецификации UML 2.5.1.
//
// Проверяет для каждого из 25 разделов:
//   1. структуру заголовков (номер + уровень) — независимый источник spec-tree.json;
//   2. блоки ```ocl — количество и побайтовое равенство содержимого;
//   3. строки inv: — количество;
//   4. таблицы — количество строк;
//   5. блоки ```text (ASCII-арт метамодели) — побайтовое равенство;
//   6. отсутствие непереведённых английских абзацев (доля кириллицы);
//   7. объём перевода относительно оригинала (0,62…1,6);
//   8. термины словаря в предписанной русской форме.
//
// Код выхода 0 — только если все 25 файлов чисты.
//
// Запуск:  node material/spec-ru/check.mjs [--verbose] [--only=09,10]
// Без зависимостей, только stdlib.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const SRC_DIR = join(ROOT, 'reference', 'spec', 'md');
const RU_DIR = join(HERE, 'ru');
const TREE = join(ROOT, 'material', 'reference-content', 'spec-tree.json');
const GLOSSARY = join(HERE, 'glossary.json');

const argv = process.argv.slice(2);
const VERBOSE = argv.includes('--verbose');
const onlyArg = argv.find((a) => a.startsWith('--only='));
const ONLY = onlyArg ? onlyArg.slice('--only='.length).split(',').map((s) => s.trim()) : null;

// Файлы, у которых часть содержимого сохранена дословно как техническая:
// от указанной строки-маркера до конца файла перевод обязан совпадать с оригиналом
// побайтово. Для 24 это таблица B.1/B.2 из идентификаторов UML DI и ссылок на
// пункты; её построчная структура разрушена в самом источнике (PDF-извлечение).
const VERBATIM_REGION = {
  '24-annex-b-diagram-interchange.md': { start: 'Notation ', end: 'B.7' },
};

// Порог доли кириллицы среди букв абзаца.
const CYR_MIN = 0.2;
// Допустимое отношение объёма перевода к оригиналу.
const LEN_MIN = 0.62;
const LEN_MAX = 1.6;
// Минимальное число терминов словаря, проверяемых обратной сверкой на файл.
const TERM_TOP = 40;

// ---------------------------------------------------------------- разбор md

/** Разбирает markdown спецификации на структурные части. */
function parse(text) {
  const lines = text.split('\n');
  const headings = [];
  const oclBlocks = [];
  const textBlocks = [];
  const invLines = [];
  const tableRows = [];
  const paragraphs = []; // {text, line}
  let fence = null; // {info, indent, start, buf, line}
  let para = null;

  const flush = () => {
    if (para && para.text.trim()) paragraphs.push(para);
    para = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];

    if (fence) {
      if (/inv:/.test(raw)) invLines.push(raw.trim());
      const close = raw.match(/^\s*```\s*$/);
      if (close) {
        const content = fence.buf.join('\n');
        if (fence.info === 'ocl') oclBlocks.push(content);
        else textBlocks.push(content);
        fence = null;
      } else {
        fence.buf.push(raw);
      }
      continue;
    }

    const open = raw.match(/^(\s*)```(\S*)\s*$/);
    if (open) {
      flush();
      fence = { indent: open[1].length, info: open[2], buf: [], line: i + 1 };
      continue;
    }

    if (/^\s*$/.test(raw)) {
      flush();
      continue;
    }

    const h = raw.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flush();
      const body = h[2].trim();
      const num = body.match(/^(\d+(?:\.\d+)*)\b/);
      headings.push({
        level: h[1].length,
        number: num ? num[1] : null,
        title: num ? body.slice(num[1].length).trim() : body,
        line: i + 1,
      });
      continue;
    }

    if (/^\s*\|/.test(raw)) {
      flush();
      tableRows.push(raw.trim());
      continue;
    }

    // Цитаты-метаданные (`> **UML 2.5.1** …`) и прочие blockquote — не текст для перевода.
    if (/^\s*>/.test(raw)) {
      flush();
      continue;
    }

    if (/inv:/.test(raw)) invLines.push(raw.trim());

    if (!para) para = { text: raw, line: i + 1 };
    else para.text += '\n' + raw;
  }
  flush();

  return { headings, oclBlocks, textBlocks, invLines, tableRows, paragraphs };
}

/** Доля кириллических букв среди всех букв. */
function cyrShare(s) {
  const cyr = (s.match(/[А-Яа-яЁё]/g) || []).length;
  const lat = (s.match(/[A-Za-z]/g) || []).length;
  const total = cyr + lat;
  return total === 0 ? null : cyr / total;
}

/**
 * Убирает из абзаца объявления метамодели — то, что переводить не нужно и что
 * иначе разбавило бы долю кириллицы: {subsets …}, [0..*], (opposite X::y),
 * ссылки A::b и идентификаторы вроде ownedAttribute или A_x_y.
 */
function stripDeclarations(text) {
  return text
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\(opposite[^)]*\)/g, ' ')
    .replace(/\([^()]*:[^()]*\)/g, ' ')
    .replace(/\b[\w$.]*::[\w$.]*/g, ' ')
    .replace(/\b[A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_]+\b/g, ' ')
    .replace(/\b[a-z][a-z0-9]*[A-Z][A-Za-z0-9]*\b/g, ' ')
    .replace(/[♦◆]/g, ' ');
}

/**
 * Абзац считается прозой, которую обязаны перевести, если это не строка
 * диаграммы (ASCII-арт, вытекший из PDF вне ограды), не объявление метамодели,
 * не подпись из одного слова и не огрызок разметки.
 */
/** Слова абзаца без пунктуации по краям. */
function words(t) {
  return t
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, ''))
    .filter((w) => /\p{L}/u.test(w));
}

/** Длина самой длинной цепочки подряд идущих латинских слов. */
function maxLatinRun(ws) {
  let best = 0;
  let cur = 0;
  for (const w of ws) {
    if (/^[A-Za-z][A-Za-z'’-]*$/.test(w)) {
      cur++;
      if (cur > best) best = cur;
    } else cur = 0;
  }
  return best;
}

function isProse(p) {
  // ASCII-арт: длинные серии пробелов, рамки, стрелки, фигурные скобки нотации.
  if (/ {3,}/.test(p.text)) return false;
  if (/[─│┌┐└┘├┤┬┴┼▲▼◀▶→←↑↓]/.test(p.text)) return false;
  const stripped = stripDeclarations(p.text).replace(/\s+/g, ' ').trim();
  if (!stripped) return false;
  // Грамматические продукции нотации (::=) и строки, начинающиеся со стереотипа, — не проза.
  if (/::=/.test(p.text)) return false;
  // Содержимое разделов состояния: entry/…, exit/…, do/… — нотация, а не текст.
  if (/^(entry|exit|do)\s*[\/:]/.test(stripped)) return false;
  // Перечень имён собственных (авторы, организации) — не переводится.
  const ws0 = words(stripped);
  if (ws0.length >= 4) {
    const cap = ws0.filter((w) => /^[A-ZА-ЯЁ]/.test(w)).length;
    if (cap / ws0.length > 0.8) return false;
  }
  // Фрагмент OCL, вытекший из ограды при извлечении из PDF: ни одной кириллической
  // буквы и явные признаки выражений OCL. Это код, а не абзац для перевода.
  if (cyrShare(stripped) === 0 && /->|::|\b(implies|oclIs\w*|oclAsType|forAll|select|notEmpty)\b/.test(stripped)) {
    return false;
  }
  // XMI/XML и URI — код обмена, он не переводится.
  if (/<\/?[A-Za-z]|xmi:|xmlns|https?:\/\//.test(p.text)) return false;
  // XML-атрибуты внутри кода обмена: text="…" , duplicatesIssue="ex67"/>
  if (/^[\w:.-]+\s*=\s*["']/m.test(p.text.trim())) return false;
  // Пункт библиографии: название документа стандарта остаётся на языке оригинала.
  if (/^[-*]\s.*(ISO\/IEC|OMG|IETF|IEEE|RFC)\b/.test(stripped)) return false;
  if (/^[«»\s]/.test(stripped)) return false;
  // Содержимое фигур: строки с нотационной разметкой.
  if (/->|<<|>>/.test(p.text) && cyrShare(stripped) < 0.1) return false;
  // Строка «имя: Тип» — содержимое прямоугольника классификатора, а не текст.
  const toks = stripped.split(/\s+/);
  const art = toks.filter((w) => /[:=]$/.test(w) || /^[/+]/.test(w)).length;
  if (art >= 3) return false;
  if (words(stripped).length < 4) return false;
  return true;
}

/** Абзац не переведён: цепочка из 4+ латинских слов или ни одной кириллической буквы. */
/**
 * Абзац начинается с английской связки — вводная к листингу, подпись или
 * начало необработанного абзаца. Проверяется для ВСЕХ абзацев, включая те,
 * что исключены из прозы как код: длинный XML/URI внутри абзаца разбавляет
 * долю кириллицы и иначе маскирует непереведённую вводную.
 */
function startsWithEnglish(text) {
  const t = stripDeclarations(text).replace(/\s+/g, ' ').trim();
  if (t.length <= 60) return false;
  // Строка начинается с разметки, знака или числа — это BNF, пример или арт.
  if (/^[\[\]<{(*0-9|]/.test(t)) return false;
  return /^(The|This|These|That|A|An|In|For|When|Where|If|Figure|Table|NOTE|Note|See|Each|All)\b/.test(t);
}

/**
 * Английская связка — служебное слово, которое в русском тексте почти не встречается.
 * Считаем абзац непереведённым, если он латинский по буквам и набит связками,
 * НЕЗАВИСИМО от того, похож ли он на арт: именно на этом ловится проза, у которой
 * PDF разорвал маркеры подпунктов («o    text…») и которая иначе выглядела как арт.
 */
const CONNECTIVE = /\b(the|this|that|these|those|is|are|was|were|has|have|had|which|with|from|must|shall|may|and|of|to|in|for|be|as|on|by|or|not)\b/gi;

function latinProse(text) {
  const t = stripDeclarations(text).replace(/\s+/g, ' ').trim();
  const lat = (t.match(/[A-Za-z]/g) || []).length;
  const cyr = (t.match(/[А-Яа-яЁё]/g) || []).length;
  if (lat + cyr < 20) return false;
  if (lat / (lat + cyr) < 0.6) return false;
  if ((t.match(CONNECTIVE) || []).length < 3) return false;
  // Исключение только по явному признаку: перечень идентификаторов и ссылок,
  // а не текст, — доля обычных строчных английских слов в нём мала.
  const toks = t.split(/\s+/).filter(Boolean);
  const plain = toks.filter((w) => /^[a-z][a-z'’-]{2,}$/.test(w)).length;
  return plain / toks.length >= 0.3;
}

function looksUntranslated(text) {
  const t = stripDeclarations(text).replace(/\s+/g, ' ').trim();
  const ws = words(t);
  if (ws.length < 4) return false;
  if (startsWithEnglish(text)) return true;
  const share = cyrShare(t);
  return share !== null && share < CYR_MIN;
}

/** Абзац переведён, но содержит длинную английскую вставку — повод проверить глазами. */
function suspicious(text) {
  const t = stripDeclarations(text).replace(/\s+/g, ' ').trim();
  const ws = words(t);
  if (ws.length < 4) return false;
  const share = cyrShare(t);
  return share !== null && share >= CYR_MIN && maxLatinRun(ws) >= 4;
}

// ------------------------------------------------------- независимое дерево

function loadTree() {
  const tree = JSON.parse(readFileSync(TREE, 'utf8'));
  const byFile = new Map();
  const walk = (nodes) => {
    for (const n of nodes) {
      if (!byFile.has(n.file)) byFile.set(n.file, []);
      byFile.get(n.file).push({ number: n.number, level: n.level, title: n.title });
      if (n.children) walk(n.children);
    }
  };
  walk(tree.sections);
  return byFile;
}

// --------------------------------------------------------------- словарь

function loadGlossary() {
  const g = JSON.parse(readFileSync(GLOSSARY, 'utf8'));
  const terms = g.terms.filter((t) => t.ru && t.ru !== t.en && /[А-Яа-яЁё]/.test(t.ru));
  // Основа русского слова: отбрасываем окончание, чтобы ловить падежи.
  const stem = (ru) => {
    const w = ru.split(/[\s,()—/]+/)[0].toLowerCase();
    if (w.length <= 4) return w;
    return w.slice(0, w.length - 2);
  };
  return terms.map((t) => ({
    en: t.en,
    ru: t.ru,
    stem: stem(t.ru),
    forms: t.forms ? [stem(t.ru), ...t.forms] : [stem(t.ru)],
    kind: t.kind,
  }));
}

/** Английское слово целиком, вне ограждений, с границей слова. */
function countEn(text, en) {
  const re = new RegExp(`(?<![A-Za-z])${en.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z])`, 'g');
  return (text.match(re) || []).length;
}

// ---------------------------------------------------------------- проверки

function checkFile(file, srcText, ruPath, treeByFile, terms) {
  const res = {
    file,
    ok: true,
    errors: [],
    warns: [],
    stats: {},
  };
  const fail = (msg) => {
    res.ok = false;
    res.errors.push(msg);
  };

  if (!existsSync(ruPath)) {
    fail('перевода нет: material/spec-ru/ru/' + basename(ruPath));
    return res;
  }

  const ruText = readFileSync(ruPath, 'utf8');
  const src = parse(srcText);
  const dst = parse(ruText);

  // Дословный технический регион: от строки-маркера до строки перед маркером конца.
  // Всё остальное — обычная проза, в том числе ПОСЛЕ региона.
  const vreg = VERBATIM_REGION[file];
  const ruL = ruText.split('\n');
  let vFrom = 0;
  let vTo = 0;
  if (vreg) {
    const a = ruL.findIndex((l) => l.startsWith(vreg.start));
    const b = a < 0 ? -1 : ruL.findIndex((l, i) => i > a && l.startsWith(vreg.end));
    if (a >= 0 && b > a) {
      vFrom = a + 1;
      vTo = b;
    } else {
      vFrom = -1;
    }
  }
  const inVerbatim = (line) => vFrom > 0 && line >= vFrom && line < vTo;

  // 1. Заголовки: сверяем с независимым деревом и между собой.
  // Приложения нумеруются словами («Annex A»), поэтому нечисловой номер
  // нормализуется в «x» с обеих сторон: иначе оригинал «расходится» с деревом.
  const norm = (num) => (num && /^\d/.test(num) ? num : 'x');
  const treeHeads = (treeByFile.get(file) || []).map((n) => `${n.level}:${norm(n.number)}`);
  const srcHeads = src.headings.map((h) => `${h.level}:${norm(h.number)}`);
  const dstHeads = dst.headings.map((h) => `${h.level}:${norm(h.number)}`);
  res.stats.headings = dstHeads.length;
  if (treeHeads.join(',') !== srcHeads.join(',')) {
    fail(`исходник разошёлся с spec-tree.json (${srcHeads.length} заголовков против ${treeHeads.length}) — проверьте material/reference-content`);
  }
  if (srcHeads.join(',') !== dstHeads.join(',')) {
    const missing = srcHeads.filter((h, i) => dstHeads[i] !== h);
    const lost = srcHeads.filter((h) => !dstHeads.includes(h));
    const extra = dstHeads.filter((h) => !srcHeads.includes(h));
    if (lost.length) fail(`потеряны заголовки: ${lost.slice(0, 6).join(' ')}${lost.length > 6 ? ` … ещё ${lost.length - 6}` : ''}`);
    if (extra.length) fail(`лишние заголовки: ${extra.slice(0, 6).join(' ')}${extra.length > 6 ? ` … ещё ${extra.length - 6}` : ''}`);
    if (!lost.length && !extra.length) fail(`порядок заголовков не совпадает, первое расхождение: ${missing[0]}`);
    // числовые заголовки без текста
    const untranslated = dst.headings.filter((h, i) => {
      const t = h.title || '';
      const share = cyrShare(t);
      return share !== null && share < 0.2 && !/^[A-Za-z]+\s*\(/.test(t) && !/^\[/.test(t);
    });
    if (untranslated.length) res.warns.push(`заголовки без кириллицы: ${untranslated.slice(0, 4).map((h) => h.number).join(', ')}`);
  }

  // 2–3. OCL блоки и строки inv:
  res.stats.ocl = dst.oclBlocks.length;
  if (dst.oclBlocks.length !== src.oclBlocks.length) {
    fail(`OCL-блоков ${dst.oclBlocks.length} вместо ${src.oclBlocks.length}`);
  } else {
    let diff = 0;
    let firstDiff = null;
    for (let i = 0; i < src.oclBlocks.length; i++) {
      if (src.oclBlocks[i] !== dst.oclBlocks[i]) {
        diff++;
        if (firstDiff === null) firstDiff = i;
      }
    }
    if (diff) {
      const a = src.oclBlocks[firstDiff].split('\n');
      const b = (dst.oclBlocks[firstDiff] || '').split('\n');
      const at = a.findIndex((l, k) => l !== b[k]);
      fail(`OCL-блок ${firstDiff + 1}: содержимое изменено (${diff} блок(ов)); строка ${at + 1}: «${(a[at] ?? '').slice(0, 70)}» → «${(b[at] ?? '').slice(0, 70)}»`);
    }
  }
  res.stats.inv = dst.invLines.length;
  if (dst.invLines.length !== src.invLines.length) {
    fail(`строк inv: ${dst.invLines.length} вместо ${src.invLines.length}`);
  } else {
    const bad = src.invLines.filter((l, i) => l !== dst.invLines[i]);
    if (bad.length) fail(`строки inv: изменены (${bad.length}), например «${bad[0].slice(0, 80)}»`);
  }

  // 4. Таблицы.
  res.stats.tables = dst.tableRows.length;
  if (dst.tableRows.length !== src.tableRows.length) {
    fail(`строк таблиц ${dst.tableRows.length} вместо ${src.tableRows.length}`);
  } else if (dst.tableRows.join('\n') === src.tableRows.join('\n') && src.tableRows.length > 0) {
    res.warns.push('таблицы не переведены (совпадают с оригиналом)');
  }

  // 5. ASCII-арт.
  res.stats.art = dst.textBlocks.length;
  if (dst.textBlocks.length !== src.textBlocks.length) {
    fail(`блоков \`\`\`text ${dst.textBlocks.length} вместо ${src.textBlocks.length}`);
  } else {
    const bad = src.textBlocks.filter((b, i) => b !== dst.textBlocks[i]);
    if (bad.length) {
      const i = src.textBlocks.findIndex((b, k) => b !== dst.textBlocks[k]);
      fail(`ASCII-арт изменён в ${bad.length} блок(ах); первый — №${i + 1}: «${(src.textBlocks[i].split('\n')[0] || '').trim().slice(0, 60)}»`);
    }
  }

  // 6. Английские абзацы.
  const englishLead = dst.paragraphs.filter(
    (p) => startsWithEnglish(p.text) && !inVerbatim(p.line),
  );
  if (englishLead.length) {
    fail(
      `английский зачин в ${englishLead.length} абзац(ах), например стр. ${englishLead[0].line}: «${englishLead[0].text.replace(/\s+/g, ' ').slice(0, 70)}»`,
    );
  }
  // Внутри дословного технического хвоста прозы нет: там идентификаторы и ссылки.
  // Латинская проза со связками — проверяется независимо от isProse.
  const latinLeft = dst.paragraphs.filter(
    (p) => latinProse(p.text) && !inVerbatim(p.line),
  );
  if (latinLeft.length) {
    fail(
      `непереведённая латинская проза (связки+латиница) ${latinLeft.length} абз., например стр. ${latinLeft[0].line}: «${latinLeft[0].text.replace(/\s+/g, ' ').slice(0, 80)}»`,
    );
  }
  const prose = dst.paragraphs.filter((p) => isProse(p) && !inVerbatim(p.line));
  const suspiciousParas = prose.filter((p) => suspicious(p.text));
  if (suspiciousParas.length) {
    res.warns.push(
      `английские вставки в переведённых абзацах (${suspiciousParas.length}), например стр. ${suspiciousParas[0].line}: «${suspiciousParas[0].text.replace(/\s+/g, ' ').slice(0, 70)}»`,
    );
  }
  const untranslated = [];
  for (const p of prose) {
    if (!looksUntranslated(p.text)) continue;
    const share = cyrShare(stripDeclarations(p.text));
    untranslated.push({ p, share: share ?? 0 });
  }
  res.stats.prose = prose.length;
  if (untranslated.length) {
    const sample = untranslated.slice(0, VERBOSE ? 60 : 3).map((u) => `стр. ${u.p.line} (кириллицы ${(u.share * 100).toFixed(0)} %): «${u.p.text.replace(/\s+/g, ' ').slice(0, 60)}»`);
    fail(`непереведённых абзацев ${untranslated.length}: ${sample.join('; ')}`);
  }

  // 7. Объём.
  const ratio = ruText.length / srcText.length;
  res.stats.ratio = ratio;
  if (ratio < LEN_MIN) fail(`перевод короче оригинала в ${ratio.toFixed(2)} раза (нижний порог ${LEN_MIN}) — похоже на пересказ`);
  if (ratio > LEN_MAX) fail(`перевод длиннее оригинала в ${ratio.toFixed(2)} раза (верхний порог ${LEN_MAX}) — похоже на вольность`);

  // 9. Дословный технический хвост (см. VERBATIM_TAIL).
  if (vreg) {
    const srcLines = srcText.split('\n');
    const sa = srcLines.findIndex((l) => l.startsWith(vreg.start));
    const sb = sa < 0 ? -1 : srcLines.findIndex((l, i) => i > sa && l.startsWith(vreg.end));
    if (vFrom < 0 || sa < 0 || sb < 0) {
      fail(`дословный регион не найден (маркеры «${vreg.start}» … «${vreg.end}»)`);
    } else {
      const sReg = srcLines.slice(sa, sb).join('\n');
      const dReg = ruL.slice(vFrom - 1, vTo).join('\n');
      res.stats.verbatim = vTo - vFrom;
      if (sReg !== dReg) {
        let at = 0;
        while (at < Math.min(sReg.length, dReg.length) && sReg[at] === dReg[at]) at++;
        fail(`дословный регион разошёлся с оригиналом около знака ${at}: «${sReg.slice(at, at + 60).replace(/\n/g, '⏎')}» → «${dReg.slice(at, at + 60).replace(/\n/g, '⏎')}»`);
      }
      // Обратная проверка границы: сразу за регионом не должно начинаться его продолжение.
      if (dReg.endsWith('isIcon=true)') === false) {
        res.warns.push('дословный регион не заканчивается ожидаемой последней строкой таблицы');
      }
    }
  }

  // 8. Термины словаря.
  const srcProse = src.paragraphs.filter(isProse).map((p) => stripDeclarations(p.text)).join('\n');
  const dstProse = dst.paragraphs.filter(isProse).map((p) => stripDeclarations(p.text)).join('\n').toLowerCase();
  const cands = terms
    .map((t) => ({ ...t, n: countEn(srcProse, t.en) }))
    .filter((t) => t.n >= 5)
    .sort((a, b) => b.n - a.n)
    .slice(0, TERM_TOP);
  const misses = [];
  for (const t of cands) {
    if (!t.forms.some((f) => dstProse.includes(f))) misses.push(`${t.en} → «${t.ru}» (в оригинале ${t.n}×)`);
  }
  res.stats.terms = cands.length;
  if (misses.length) {
    fail(`термины не в предписанной форме: ${misses.slice(0, 5).join('; ')}${misses.length > 5 ? ` … ещё ${misses.length - 5}` : ''}`);
  }

  return res;
}

// ------------------------------------------------------------------- вывод

function main() {
  if (!existsSync(TREE)) {
    console.error(`нет ${TREE}`);
    process.exit(2);
  }
  const treeByFile = loadTree();
  const terms = loadGlossary();
  const files = readdirSync(SRC_DIR)
    .filter((f) => /^\d\d-.*\.md$/.test(f))
    .sort();
  const selected = ONLY ? files.filter((f) => ONLY.includes(f.slice(0, 2))) : files;

  console.log('Проверка перевода UML 2.5.1 → русский');
  console.log(`Оригинал: reference/spec/md   Перевод: material/spec-ru/ru`);
  console.log(`Словарь: ${terms.length} терминов   Файлов: ${selected.length}\n`);

  const head = ['файл', 'загол.', 'OCL', 'inv', 'табл', 'арт', 'объём', 'терм', 'итог'];
  const rows = [];
  let bad = 0;

  for (const file of selected) {
    const srcText = readFileSync(join(SRC_DIR, file), 'utf8');
    const ruPath = join(RU_DIR, file);
    const r = checkFile(file, srcText, ruPath, treeByFile, terms);
    if (!r.ok) bad++;
    rows.push([
      file.replace(/\.md$/, ''),
      r.stats.headings ?? '—',
      r.stats.ocl ?? '—',
      r.stats.inv ?? '—',
      r.stats.tables ?? '—',
      r.stats.art ?? '—',
      r.stats.ratio ? r.stats.ratio.toFixed(2) : '—',
      r.stats.terms ?? '—',
      r.ok ? 'ok' : 'FAIL',
    ]);
    if (!r.ok || VERBOSE) {
      console.log(`\n${file}`);
      for (const e of r.errors) console.log(`  ✗ ${e}`);
      for (const w of r.warns) console.log(`  · ${w}`);
    }
  }

  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  const line = (cells) => cells.map((c, i) => String(c).padEnd(widths[i])).join('  ');
  console.log('\n' + line(head));
  console.log(widths.map((w) => '─'.repeat(w)).join('  '));
  for (const r of rows) console.log(line(r));

  console.log(`\nЧисто: ${rows.length - bad} из ${rows.length}.${bad ? ` С ошибками: ${bad}.` : ''}`);
  process.exit(bad === 0 && rows.length > 0 ? 0 : 1);
}

main();