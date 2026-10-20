'use strict';
const { StringDecoder } = require('node:string_decoder');
const units = { B: 1, KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3, TiB: 1024 ** 4, PiB: 1024 ** 5, KB: 1000, MB: 1e6, GB: 1e9, TB: 1e12 };
const quantity = '(\\d+(?:\\.\\d+)?)\\s*(B|KiB|MiB|GiB|TiB|PiB|KB|MB|GB|TB)';
function bytes(value, unit) { const result = Number(value) * units[unit]; return Number.isFinite(result) && result <= Number.MAX_SAFE_INTEGER ? Math.round(result) : null; }
function seconds(text) {
  let total = 0;
  const factors = { d: 86400, h: 3600, m: 60, min: 60, s: 1, sec: 1 };
  const rest = text.replace(/(\d+(?:\.\d+)?)\s*(min|sec|d|h|m|s)\b/g, (_, value, unit) => { total += Number(value) * factors[unit]; return ''; });
  return rest.trim() || !Number.isFinite(total) || total <= 0 ? null : total;
}
function parseProgress(line, now = () => new Date().toISOString()) {
  line = line.replace(/\x1b\[[0-9;]*m/g, '');
  const match = line.match(new RegExp('\\bprocessed\\s+' + quantity + '\\s+in\\s+([^,]+),\\s+uploaded\\s+' + quantity));
  if (match) {
    const processedBytes = bytes(match[1], match[2]), uploadedBytes = bytes(match[4], match[5]), elapsedSeconds = seconds(match[3]);
    if (processedBytes === null || uploadedBytes === null || elapsedSeconds === null) return null;
    return { processedBytes, uploadedBytes, elapsedSeconds, processingBytesPerSecond: processedBytes / elapsedSeconds, updatedAt: now() };
  }
  const summary = line.match(new RegExp('\\.pxar: had to backup ' + quantity + ' of ' + quantity + ' \\(compressed ' + quantity + '\\) in (\\d+(?:\\.\\d+)?)\\s*s'));
  if (!summary) return null;
  const processedBytes = bytes(summary[3], summary[4]), elapsedSeconds = Number(summary[7]);
  if (processedBytes === null || !elapsedSeconds) return null;
  return { processedBytes, uploadedBytes: null, elapsedSeconds, processingBytesPerSecond: processedBytes / elapsedSeconds, updatedAt: now() };
}
function createProgressParser(onProgress) {
  const streams = new Map();
  function consume(state, text, flush = false) {
    const lines = (state.pending + text).split(/[\r\n]/);
    state.pending = flush ? '' : lines.pop().slice(-8192);
    for (const line of lines) { const progress = parseProgress(line); if (progress) onProgress(progress); }
  }
  return {
    push(chunk, stream = 'stdout') { let state = streams.get(stream); if (!state) { state = { decoder: new StringDecoder('utf8'), pending: '' }; streams.set(stream, state); } consume(state, state.decoder.write(chunk)); },
    end() { for (const state of streams.values()) consume(state, state.decoder.end(), true); }
  };
}
module.exports = { parseProgress, createProgressParser };
