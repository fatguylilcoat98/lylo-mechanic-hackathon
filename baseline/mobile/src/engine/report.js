/*
 * LYLO Mechanic — plain-text report for sharing (text message, email, notes).
 */
'use strict';

const { assessUsedCar } = require('./usedCarCheck');

function buildReport(scan) {
  const a = assessUsedCar(scan);
  const L = [];
  L.push('LYLO Mechanic — Used-Car Check' + (scan.demoLabel ? ' (DEMO DATA)' : ''));
  L.push(new Date(scan.timestamp || Date.now()).toLocaleString('en-US'));
  if (scan.vehicle && (scan.vehicle.year || scan.vehicle.make)) L.push('Vehicle: ' + [scan.vehicle.year, scan.vehicle.make].filter(Boolean).join(' '));
  if (scan.vin) L.push('VIN (from engine computer): ' + scan.vin);
  L.push('Adapter: ' + (scan.deviceName || '?') + (scan.adapter ? ' / ' + scan.adapter : '') + (scan.protocol ? ' / protocol ' + scan.protocol : ''));
  L.push('');
  L.push('VERDICT: ' + a.verdict.label + ' — ' + a.verdict.summary);
  L.push('');
  const icon = { red: '[!]', yellow: '[?]', green: '[OK]', info: '[i]' };
  a.findings.forEach((f) => { L.push(icon[f.level] + ' ' + f.title); if (f.detail) L.push('    ' + f.detail); });
  if (scan.monitor && scan.monitor.monitors.length) {
    L.push('');
    L.push('Readiness monitors:');
    scan.monitor.monitors.forEach((m) => L.push('  ' + (m.complete ? 'complete   ' : 'NOT READY  ') + m.name));
  }
  if (a.codes.length) {
    L.push('');
    L.push('Codes:');
    a.codes.forEach((c) => {
      L.push('  ' + c.code + ' (' + c.alsoKinds.join('/') + ') — ' + c.title);
      L.push('    ' + c.plain);
      if (c.known) L.push('    Typical fix: ' + c.fix + ' | Shop estimate ' + c.priceText.shop + ' | Difficulty ' + c.difficulty.level);
    });
    L.push('  Prices are LYLO estimates, not quotes.');
  }
  const p = scan.pids || {};
  const keys = Object.keys(p);
  if (keys.length) {
    L.push('');
    L.push('Raw data: ' + keys.map((k) => k + '=' + p[k]).join(', '));
  }
  if (scan.notes && scan.notes.length) L.push('Notes: ' + scan.notes.join(' '));
  L.push('');
  L.push('A computer check can\'t see everything. Always get a professional inspection before buying.');
  return L.join('\n');
}

module.exports = { buildReport };
