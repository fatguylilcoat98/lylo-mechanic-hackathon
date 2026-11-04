/* v0.7.6 guided tours registry (flag EXPO_PUBLIC_LYLO_TOUR=1). Build order: 1, 2, 3, 8, 9, then the rest. */
'use strict';
const TOURS = [
  require('./tours/01-scanclear'),
  require('./tours/02-views'),
  require('./tours/03-photo'),
  require('./tours/08-rules'),
];
module.exports = { TOURS };
