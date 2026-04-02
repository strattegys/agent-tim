/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [],
  options: {
    doNotFollow: {
      path: "node_modules",
    },
    tsPreCompilationDeps: true,
    moduleSystems: ["cjs", "es6", "amd"],
    includeOnly: "^(app|components|lib)/",
    exclude: {
      path: "(^|/)\\.next(/|$)|\\.test\\.|\\.spec\\.|/__tests__/|^scripts/",
    },
  },
};
