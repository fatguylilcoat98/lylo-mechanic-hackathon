/* v0.7.6 guided tours registry (flag EXPO_PUBLIC_LYLO_TOUR=1). Build order: 1, 2, 3, 8, 9, then the rest. */
'use strict';
const TOURS = [
  require('./tours/01-scanclear'),
  require('./tours/02-views'),
  require('./tours/03-photo'),
  require('./tours/08-rules'),
  require('./tours/09-proof'),
  require('./tours/04-collision'),
  require('./tours/05-crashguard'),
  require('./tours/06-timeline'),
  require('./tours/07-usedcar'),
  require('./tours/10-noadapter'),
  require('./tours/11-vinprice'),
];
// v0.7.7: tour 12 only when a REAL recorded Meta AI answer fixture is present and valid; otherwise hidden.
const META_TOUR = require('./tours/12-metaai').tour;
if (META_TOUR) TOURS.push(META_TOUR);
module.exports = { TOURS };
