
const text = \I need a secure web application infrastructure on Google Cloud with Java and MySQL.

Client answers / revision feedback:
DOES THIS SETUP MATCH WHAT YOU NEED: GOOGLE CLOUD WITH GOOGLE KUBERNETES ENGINE (GKE) AND GITHUB ACTIONS, USING JAVA AS THE MINIMAL CONTAINER RUNTIME AND MYSQL
GitLab CI

WHERE SHOULD WE HOST IT
europe-west1

WHICH ENVIRONMENTS DO YOU NEED
Production only

WHO SHOULD BE ABLE TO ACCESS THE API
Private and internal only

HOW SHOULD MYSQL BE CONFIGURED
High availability

HOW MUCH TRAFFIC SHOULD WE PLAN FOR
Medium — 3 to 5 app copies\;

function requestsMultipleClouds(text) {
  const promptLines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const revisionIndex = promptLines.findIndex((l) => l.toLowerCase().includes('revision feedback'));
  const latestPrompt = revisionIndex !== -1 && revisionIndex + 1 < promptLines.length 
    ? promptLines.slice(revisionIndex + 1).join('\n') 
    : promptLines[promptLines.length - 1] || text;
  
  const lower = latestPrompt.toLowerCase();
  const clouds = [
    /\baws\b|amazon web services/,
    /\bazure\b|microsoft azure/,
    /\b(?:gcp|google cloud)\b/,
    /\b(?:oci|oracle cloud)\b/,
  ].filter((pattern) => pattern.test(lower));
  console.log('CLOUDS:', clouds);
  return clouds.length > 1 && /\b(?:deploy|provision|build|create|use)\b/.test(lower);
}

console.log('MULTIPLE CLOUDS?', requestsMultipleClouds(text));

