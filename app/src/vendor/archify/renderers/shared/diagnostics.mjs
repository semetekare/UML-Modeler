// Браузерная замена renderers/shared/diagnostics.mjs из archify 3.0.1.
//
// Зачем замена: оригинал на первой строке делает `import fs from 'node:fs'` и
// `import path from 'node:path'` — в браузере таких модулей нет, и весь граф
// импортов (geometry.mjs → diagnostics.mjs) не загрузился бы. В оригинале fs и
// path нужны только для `rendererFailure`/`installRendererDiagnosticBoundary`,
// то есть для CLI-отчёта о сбое рендера; сами проверки геометрии их не трогают.
//
// Поверхность модуля сохранена один в один, чтобы скопированные файлы archify
// остались нетронутыми. Одно отличие: вместо записи в stderr диагностика
// копится в памяти — её забирает geometry-adapter.mjs и превращает в замечания
// панели «Проверки». Оригинал лежит рядом как diagnostics.node.mjs.
//
// Правки: только этот файл. Он не часть archify и помечен как замена в
// UPSTREAM.json (deviations).

const MAX_KEPT = 500;
const recorded = [];
const recordedMessages = new Set();

function plainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function normalizedDiagnostic(diagnostic) {
  const message = String(diagnostic?.message || 'Archify could not classify this failure.').trim();
  return {
    code: String(diagnostic?.code || 'internal/unclassified'),
    severity: diagnostic?.severity === 'warning' ? 'warning' : 'error',
    message,
    subject: plainObject(diagnostic?.subject),
    evidence: plainObject(diagnostic?.evidence),
    supportedFixes: Array.isArray(diagnostic?.supportedFixes)
      ? [...new Set(diagnostic.supportedFixes.map((fix) => String(fix).trim()).filter(Boolean))]
      : [],
    ...(Array.isArray(diagnostic?.suppresses) ? {
      suppresses: [...new Set(diagnostic.suppresses.map((code) => String(code).trim()).filter(Boolean))],
    } : {}),
  };
}

export function recordDiagnostic(diagnostic) {
  const normalized = normalizedDiagnostic(diagnostic);
  if (recordedMessages.has(normalized.message)) return;
  if (recorded.length >= MAX_KEPT) {
    recordedMessages.delete(recorded.shift().message);
  }
  recordedMessages.add(normalized.message);
  recorded.push(normalized);
}

/** Забрать накопленное и очистить буфер (для одного прогона проверок). */
export function takeDiagnostics() {
  const out = recorded.slice();
  recorded.length = 0;
  recordedMessages.clear();
  return out;
}

export function withDiagnosticRecordingSuppressed(callback) {
  // Подавление записи в браузере не нужно: буфер и так только в памяти.
  return callback();
}

export function throwDiagnosticError(message, diagnostics) {
  for (const diagnostic of diagnostics || []) recordDiagnostic(diagnostic);
  const error = new Error(message);
  error.archifyDiagnostics = (diagnostics || []).map(normalizedDiagnostic);
  throw error;
}

export function throwDiagnosticProblems(prefix, problems, { code = 'layout/constraint', subject = {}, diagnostics: details = [] } = {}) {
  const messages = (problems || []).map((problem) => String(problem));
  const byMessage = new Map((details || []).map((entry) => [entry.message, entry]));
  const diagnostics = messages.map((message) => normalizedDiagnostic(byMessage.get(message) || {
    code,
    severity: 'error',
    message,
    subject,
  }));
  throwDiagnosticError(`${prefix}: ${messages.length}`, diagnostics);
}

/** В браузере «сбой рендера» — это просто объект для вызывающего кода. */
export function rendererFailure(error) {
  return {
    code: 'internal/renderer-failure',
    severity: 'error',
    message: String(error?.message || error || 'renderer failed'),
    subject: {},
    evidence: {},
    supportedFixes: [],
  };
}

export function installRendererDiagnosticBoundary() {
  return () => {};
}
