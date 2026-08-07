
const fs = require('fs');
let code = fs.readFileSync('app/generate/page.tsx', 'utf8');
code = code.replace(
  /setResolvedPresets\(parsedPresets\);/,
  'setResolvedPresets(parsedPresets);\n      setPresets(parsedPresets);'
);
code = code.replace(
  /setPresets\({ cloud: 'aws', orchestrator: 'eks', ci: 'github-actions' }\);/,
  'setPresets({ cloud: 'aws', orchestrator: 'eks', ci: 'github-actions' });\n    setResolvedPresets({ cloud: 'aws', orchestrator: 'eks', ci: 'github-actions' });'
);
fs.writeFileSync('app/generate/page.tsx', code);

