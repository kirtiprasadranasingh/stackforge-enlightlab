
const fs = require('fs');
const ts = require('typescript');
const code = fs.readFileSync('lib/infer-presets.ts', 'utf8');
const transpiled = ts.transpile(code, { compilerOptions: { module: ts.ModuleKind.CommonJS } });
fs.writeFileSync('test-infer-transpiled.js', transpiled);

