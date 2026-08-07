
function inferPresetsFromPrompt(prompt, fallback) {
  const lower = prompt.toLowerCase().trim();
  const out = {};
  
  const promptClouds = [
    { key: 'aws', match: /\baws\b|amazon web services/ },
    { key: 'azure', match: /\bazure\b|microsoft azure/ },
    { key: 'gcp', match: /\b(?:gcp|google cloud)\b/ },
    { key: 'oracle', match: /\b(?:oci|oracle cloud)\b/ },
  ].filter((c) => c.match.test(lower));

  if (promptClouds.length > 0) {
    out.cloud = promptClouds[0].key;
  }

  if (!out.cloud && fallback?.cloud) {
    out.cloud = fallback.cloud;
  }
  
  const promptCis = [
    { key: 'github-actions', match: /github actions/ },
    { key: 'gitlab-ci', match: /gitlab/ },
    { key: 'azure-pipelines', match: /azure devops|azure pipelines/ },
    { key: 'oci-devops', match: /oci devops/ },
  ].filter((c) => c.match.test(lower));

  if (promptCis.length > 0) {
    out.ci = promptCis[0].key;
  }

  if (!out.ci && fallback?.ci) {
    out.ci = fallback.ci;
  }
  
  return out;
}

const formattedAnswers = 'DOES THIS SETUP MATCH WHAT YOU NEED: GOOGLE CLOUD WITH GOOGLE KUBERNETES ENGINE (GKE) AND GITHUB ACTIONS, USING JAVA AS THE MINIMAL CONTAINER RUNTIME AND MYSQL\\nGitLab CI\\n\\nWHERE SHOULD WE HOST IT\\neurope-west1\\n\\nWHICH ENVIRONMENTS DO YOU NEED\\nProduction only\\n\\nWHO SHOULD BE ABLE TO ACCESS THE API\\nPrivate and internal only\\n\\nHOW SHOULD MYSQL BE CONFIGURED\\nHigh availability\\n\\nHOW MUCH TRAFFIC SHOULD WE PLAN FOR\\nMedium — 3 to 5 app copies';

console.log(inferPresetsFromPrompt(formattedAnswers, { cloud: 'aws', ci: 'github-actions' }));

