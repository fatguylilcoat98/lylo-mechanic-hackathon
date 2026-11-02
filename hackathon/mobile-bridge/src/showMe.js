/*
 * LYLO Mechanic v0.6: "Tell LYLO what's wrong" (pure CommonJS).
 * Flags: EXPO_PUBLIC_LYLO_NOSENSOR_HOME=1 (Home primary button is the no-sensor check when no adapter is connected)
 *        EXPO_PUBLIC_LYLO_SHOWME=1 (No-adapter screen: photo first, one result card, tap-to-answer follow-ups, fix-it card)
 * Honesty: causes are the AI's/rules' guesses and are labeled that way; follow-up answers are the owner's own words.
 */
'use strict';

const P = require('./priceLinks');

const DIY_EASY = /\b(air filter|cabin (air )?filter|wiper|gas cap|fuel cap|battery|bulb|headlight|tail ?light|fuse)\b/i;
const MAX_FOLLOW = 3;

function flagOn(v) { return String(v || '').trim() === '1'; }
function features(env) {
  const g = (k) => { try { return env ? env[k] : process.env[k]; } catch (e) { return undefined; } };
  return { home: flagOn(g('EXPO_PUBLIC_LYLO_NOSENSOR_HOME')), showMe: flagOn(g('EXPO_PUBLIC_LYLO_SHOWME')) };
}

/** Ranked causes from the server reply; every one labeled a guess. */
function causesFrom(body) {
  const rank = { high: 0, medium: 1, low: 2 };
  return (body && Array.isArray(body.hypotheses) ? body.hypotheses : [])
    .filter((h) => h && h.cause)
    .map((h) => ({ cause: String(h.cause), confidence: h.confidence || 'low', label: `Guess (${h.confidence || 'low'} confidence)` }))
    .sort((a, b) => (rank[a.confidence] ?? 3) - (rank[b.confidence] ?? 3));
}

function followUps(view) { return (view && Array.isArray(view.followUps) ? view.followUps : []).slice(0, MAX_FOLLOW); }

/** Owner's answer to a follow-up, appended in their own words (quoted question, plain answer). */
function appendAnswer(text, question, answer) {
  const a = { yes: 'yes', no: 'no', unsure: 'not sure' }[answer] || 'not sure';
  return `${String(text || '').trim()} (Asked: "${String(question).slice(0, 160)}" Owner answered: ${a}.)`.trim().slice(0, 1000);
}

/** Fix-it card for the top cause: price + store links + Watch how + Photo Helper + DIY hint. Null when no part is named. */
function fixIt(causes, vehicle) {
  const top = causes && causes[0];
  if (!top) return null;
  const part = P.partFromCause(top.cause);
  const name = P.vehicleName(vehicle);
  const q = [name, part || top.cause, part ? 'replace' : 'diagnose'].filter(Boolean).join(' ');
  const links = part ? P.priceLinks(part, vehicle, null) : null;
  return {
    title: `If it is: ${top.cause}`, guess: top.label, part,
    diy: part && DIY_EASY.test(part) ? 'Often a do-it-yourself job with basic tools (LYLO guide, not a guarantee).'
      : 'Probably a shop job, or get it checked first. Ask for a written quote.',
    links, watchUrl: P.youtubeUrl(q), photoHelper: !!part, nearby: P.NEARBY,
    note: 'This is for the top guess only. Confirm the cause before buying parts.',
  };
}

module.exports = { features, causesFrom, followUps, appendAnswer, fixIt, DIY_EASY, MAX_FOLLOW };
