import type { CIProvider, CloudProvider, Orchestrator, Presets } from '@/types';

function parseClientOverrides(prompt: string): Partial<Presets> {
  const out: Partial<Presets> = {};

  const cloudMatch = prompt.match(
    /cloud provider(?:\s*\(client override\))?\s*:\s*([^.\n]+)/i
  );
  if (cloudMatch) {
    const c = cloudMatch[1].toLowerCase();
    if (/oracle|oci/.test(c)) out.cloud = 'oracle';
    else if (/azure|microsoft/.test(c)) out.cloud = 'azure';
    else if (/google|gcp/.test(c)) out.cloud = 'gcp';
    else if (/aws|amazon/.test(c)) out.cloud = 'aws';
  }

  // UI may prettify to: "Microsoft Azure. Hosting platform (client override): AKS..."
  // or "Oracle Cloud Infrastructure. Hosting platform (client override): OKE..."
  if (!out.cloud) {
    if (
      /microsoft\s+azure[\s\S]{0,120}hosting platform(?:\s*\(client override\))?/i.test(
        prompt
      ) ||
      /\bmicrosoft\s+azure\b[\s\S]{0,80}\baks\b/i.test(prompt)
    ) {
      out.cloud = 'azure';
    } else if (
      /oracle cloud infrastructure[\s\S]{0,200}hosting platform(?:\s*\(client override\))?/i.test(
        prompt
      )
    ) {
      out.cloud = 'oracle';
    } else if (
      /google cloud[\s\S]{0,120}hosting platform(?:\s*\(client override\))?/i.test(prompt)
    ) {
      out.cloud = 'gcp';
    } else if (
      /\baws\b[\s\S]{0,120}hosting platform(?:\s*\(client override\))?/i.test(prompt) ||
      /amazon web services[\s\S]{0,120}hosting platform(?:\s*\(client override\))?/i.test(
        prompt
      )
    ) {
      out.cloud = 'aws';
    }
  }

  const hostingMatch = prompt.match(
    /hosting platform(?:\s*\(client override\))?\s*:\s*([^.\n]+)/i
  );
  if (hostingMatch) {
    const h = hostingMatch[1].toLowerCase();
    if (/oke|oracle kubernetes/.test(h)) {
      out.orchestrator = 'oke';
      out.cloud = 'oracle';
    } else if (/azure kubernetes|\baks\b/.test(h)) {
      out.orchestrator = 'aks';
      out.cloud = 'azure';
    } else if (/container apps?/.test(h)) {
      out.orchestrator = 'container-apps';
      out.cloud = out.cloud || 'azure';
    } else if (/\beks\b|elastic kubernetes/.test(h)) {
      out.orchestrator = 'eks';
      out.cloud = out.cloud || 'aws';
    } else if (/\bgke\b|google kubernetes/.test(h)) {
      out.orchestrator = 'gke';
      out.cloud = out.cloud || 'gcp';
    } else if (/cloud run/.test(h)) {
      out.orchestrator = 'cloud-run';
      out.cloud = out.cloud || 'gcp';
    } else if (/\becs\b|fargate/.test(h)) {
      out.orchestrator = 'ecs';
      out.cloud = out.cloud || 'aws';
    }
  }

  const ciMatch = prompt.match(/ci\/cd system(?:\s*\(client override\))?\s*:\s*([^.\n]+)/i);
  if (ciMatch) {
    const ci = ciMatch[1].toLowerCase();
    if (/azure devops|azure pipelines/.test(ci)) out.ci = 'azure-devops';
    else if (/gitlab/.test(ci)) out.ci = 'gitlab-ci';
    else if (/jenkins/.test(ci)) out.ci = 'jenkins';
    else if (/github/.test(ci)) out.ci = 'github-actions';
    else if (/codepipeline|code pipeline|codebuild|code build/.test(ci)) {
      out.ci = 'aws-codepipeline';
    } else if (/cloud build|cloudbuild/.test(ci)) out.ci = 'gcp-cloud-build';
    else if (/oci devops|oracle devops/.test(ci)) out.ci = 'oci-devops';
  }

  if (
    /oracle cloud infrastructure[\s\S]{0,200}hosting platform(?:\s*\(client override\))?\s*:[^.\n]*(oke|oracle kubernetes)/i.test(
      prompt
    )
  ) {
    out.cloud = 'oracle';
    out.orchestrator = 'oke';
  }

  if (
    /microsoft\s+azure[\s\S]{0,200}hosting platform(?:\s*\(client override\))?\s*:[^.\n]*(aks|azure kubernetes)/i.test(
      prompt
    )
  ) {
    out.cloud = 'azure';
    out.orchestrator = 'aks';
  }

  return out;
}

function detectCloudFromText(rawText: string): Presets['cloud'] | null {
  const t = rawText.toLowerCase();
  const tCloud = t
    .replace(/azure\s*devops(?:\s*pipelines)?/gi, ' ')
    .replace(/azure\s*pipelines/gi, ' ')
    .replace(/google\s*cloud\s*build/gi, ' ')
    .replace(/oci\s*devops/gi, ' ');

  // A named hosting platform is the strongest cloud signal. Service names
  // from another cloud can appear in a conflicting request (for example,
  // "Cloud Run using Azure Key Vault") and must not redirect the scaffold to
  // the service provider's cloud.
  if (/\boke\b|oracle\s+kubernetes/.test(tCloud)) return 'oracle';
  if (/\baks\b|azure\s+kubernetes|container\s*apps?/.test(tCloud)) return 'azure';
  if (/\bgke\b|google\s+kubernetes|cloud\s*run/.test(tCloud)) return 'gcp';
  if (/\beks\b|amazon\s+ecs|\becs\b|\bfargate\b/.test(tCloud)) return 'aws';

  const mentionsOracle =
    /\boracle\b/.test(tCloud) ||
    /\boci\b/.test(tCloud) ||
    /\boke\b/.test(tCloud);
  const mentionsAzure =
    /\bazure\b/.test(tCloud) ||
    /\baks\b/.test(tCloud) ||
    /container\s*apps?/.test(tCloud) ||
    /\bazurerm\b/.test(tCloud) ||
    /microsoft\s*azure/.test(tCloud);
  const mentionsGcp =
    /\bgcp\b/.test(tCloud) ||
    /\bgke\b/.test(tCloud) ||
    /google\s*cloud|googlecloud/.test(tCloud) ||
    /cloud\s*run/.test(tCloud);
  const mentionsAws =
    /\baws\b/.test(t) ||
    /\beks\b/.test(t) ||
    /\becs\b/.test(t) ||
    /\bfargate\b/.test(t);

  if (mentionsOracle && !mentionsAws && !mentionsAzure && !mentionsGcp) return 'oracle';
  if (mentionsAzure && !mentionsAws && !mentionsGcp && !mentionsOracle) return 'azure';
  if (mentionsGcp && !mentionsAws && !mentionsAzure && !mentionsOracle) return 'gcp';
  if (mentionsAws && !mentionsAzure && !mentionsGcp && !mentionsOracle) return 'aws';

  // Priority fallback when multiple mentions exist: single match check
  if (mentionsOracle) return 'oracle';
  if (mentionsAzure) return 'azure';
  if (mentionsGcp) return 'gcp';
  if (mentionsAws) return 'aws';

  return null;
}

/**
 * Infer cloud / orchestrator / CI from free-text when the user names them explicitly.
 * Used so silent UI defaults (aws/eks/github-actions) do not override a clear prompt.
 */
export function inferPresetsFromPrompt(prompt: string, current: Presets): Presets {
  const t = prompt.toLowerCase();
  const overrides = parseClientOverrides(prompt);

  // Check the latest prompt line first so history from previous turns does not override new requests
  const promptLines = prompt.split('\n').map((l) => l.trim()).filter(Boolean);
  const revisionIndex = promptLines.findIndex(l => l.toLowerCase().includes('revision feedback'));
  const latestPrompt = revisionIndex !== -1 && revisionIndex + 1 < promptLines.length 
    ? promptLines.slice(revisionIndex + 1).join('\n') 
    : promptLines[promptLines.length - 1] || prompt;
  const latestCloud = detectCloudFromText(latestPrompt);

  let cloud = overrides.cloud ?? latestCloud ?? detectCloudFromText(prompt) ?? current.cloud;
  let orchestrator = overrides.orchestrator ?? current.orchestrator;
  let ci = overrides.ci ?? current.ci;

  const tCloud = t
    .replace(/azure\s*devops(?:\s*pipelines)?/gi, ' ')
    .replace(/azure\s*pipelines/gi, ' ')
    .replace(/google\s*cloud\s*build/gi, ' ')
    .replace(/oci\s*devops/gi, ' ');
  const mentionsAzure = cloud === 'azure';
  const mentionsAws = cloud === 'aws';
  const mentionsGcp = cloud === 'gcp';
  const mentionsOracle = cloud === 'oracle';

  const namedCloud = Boolean(cloud);

  if (!overrides.orchestrator) {
    if (namedCloud && cloud === 'azure') {
      if (/\baks\b/.test(t) || /azure\s+kubernetes/.test(t) || /kubernetes\s+service/.test(t)) {
        orchestrator = 'aks';
      } else if (/container\s*apps?/.test(t) || /serverless\s*containers?/.test(t)) {
        orchestrator = 'container-apps';
      } else if (/kubernetes/.test(t) || /\bk8s\b/.test(t)) {
        orchestrator = 'aks';
      } else {
        orchestrator = 'aks';
      }
    } else if (namedCloud && cloud === 'aws') {
      if (/\becs\b/.test(t) || /\bfargate\b/.test(t)) orchestrator = 'ecs';
      else orchestrator = 'eks';
    } else if (namedCloud && cloud === 'gcp') {
      if (/cloud\s*run/.test(t) || /serverless/.test(t)) orchestrator = 'cloud-run';
      else orchestrator = 'gke';
    } else if (namedCloud && cloud === 'oracle') {
      orchestrator = 'oke';
    }
  }

  if (!overrides.ci) {
    if (/azure\s*devops|azure\s*pipelines|\bazdo\b/.test(t)) {
      ci = 'azure-devops';
    } else if (/gitlab(\s*ci)?/.test(t)) {
      ci = 'gitlab-ci';
    } else if (/\bjenkins\b/.test(t)) {
      ci = 'jenkins';
    } else if (/code\s*pipeline|codepipeline|code\s*build|codebuild/.test(t)) {
      // Before GitHub Actions — interview questions often mention GHA in the
      // setup stem while the client pick is CodePipeline (ZIP-24 class bug).
      ci = 'aws-codepipeline';
    } else if (/cloud\s*build|cloudbuild/.test(t)) {
      ci = 'gcp-cloud-build';
    } else if (/oci\s*devops|oracle\s*devops/.test(t)) {
      ci = 'oci-devops';
    } else if (/github\s*actions|\.github\/workflows/.test(t)) {
      ci = 'github-actions';
    }
  }

  if (orchestrator === 'oke') {
    cloud = 'oracle';
  }
  if (orchestrator === 'aks') {
    cloud = 'azure';
  }
  if (orchestrator === 'eks' || orchestrator === 'ecs') {
    cloud = 'aws';
  }
  if (orchestrator === 'gke' || orchestrator === 'cloud-run') {
    cloud = 'gcp';
  }

  // Explicit AWS/ECS (or EKS) hosting always beats CI-native cloud pairing.
  // Fixes: AWS + Azure DevOps wrongly becoming Azure Container Apps (ZIP 37 / QA #24).
  if (!overrides.cloud && mentionsAws && (/\becs\b/.test(t) || /\bfargate\b/.test(t) || /\beks\b/.test(t))) {
    cloud = 'aws';
    if (/\becs\b/.test(t) || /\bfargate\b/.test(t)) orchestrator = 'ecs';
    else if (/\beks\b/.test(t)) orchestrator = 'eks';
  }

  // Native cloud CI must not stay paired with silent AWS/EKS UI defaults.
  // e.g. "Change CI/CD: OCI DevOps" alone → Oracle + OKE + OCIR (never AWS ECR/EKS).
  if (ci === 'oci-devops' && !mentionsAws && !mentionsAzure && !mentionsGcp) {
    cloud = 'oracle';
    orchestrator = 'oke';
  }
  if (ci === 'gcp-cloud-build' && !mentionsAws && !mentionsAzure && !mentionsOracle) {
    cloud = 'gcp';
    orchestrator =
      overrides.orchestrator === 'cloud-run' || /\bcloud\s*run\b/.test(t)
        ? 'cloud-run'
        : 'gke';
  }
  if (ci === 'aws-codepipeline' && !mentionsAzure && !mentionsGcp && !mentionsOracle) {
    cloud = 'aws';
  }
  if (ci === 'azure-devops' && !mentionsAws && !mentionsGcp && !mentionsOracle) {
    cloud = 'azure';
  }

  return {
    cloud: cloud as CloudProvider,
    orchestrator: orchestrator as Orchestrator,
    ci: ci as CIProvider,
  };
}

/** True when the prompt itself names a cloud/orchestrator (not UI defaults alone). */
export function promptNamesCloud(prompt: string): boolean {
  const t = prompt
    .toLowerCase()
    .replace(/azure\s*devops(?:\s*pipelines)?/gi, ' ')
    .replace(/azure\s*pipelines/gi, ' ');
  return (
    /\b(aws|azure|gcp|oci|oracle|eks|gke|aks|oke|ecs|fargate|lambda|container\s*apps?|cloud\s*run|google\s*cloud)\b/.test(
      t
    )
  );
}
