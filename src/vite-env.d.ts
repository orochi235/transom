/// <reference types="vite/client" />
/// <reference types="@weasel-js/icons-plugin/virtual" />

/** True in the public demo build, where there is no daemon: the wall is fed by
 *  `src/demo/daemon.ts` instead of a WebSocket. Replaced at build time, so the
 *  demo is absent from the ordinary bundle rather than merely switched off. */
declare const __TRANSOM_DEMO__: boolean
