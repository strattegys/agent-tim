/**
 * Preload for CLI scripts that import app libs using `import "server-only"`.
 * @example node -r ./scripts/empty-server-only.cjs --import tsx ./scripts/run-unipile-inbound-replay.ts
 */
"use strict";
const Module = require("module");
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") {
    return {};
  }
  return origLoad.apply(this, arguments);
};
