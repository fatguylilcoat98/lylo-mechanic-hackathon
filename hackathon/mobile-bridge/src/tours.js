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
];
module.exports = { TOURS };
