module.exports = {
  ...require("./jest.config"),
  testRegex: ".*\\.integration\\.spec\\.ts$",
  testPathIgnorePatterns: ["/node_modules/"],
  setupFiles: ["<rootDir>/src/load-local-env.ts"],
};
