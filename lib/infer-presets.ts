import type { CIProvider, CloudProvider, Orchestrator, Presets } from '@/types';

function parseClientOverrides(prompt: string): Partial<Presets> {
  const out: Partial<Presets> = {};

  const cloudMatch = prompt.match(
    /cloud provider\s*\(client override\)\s*:\s*([^.\n]+)/i
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
      /microsoft\s+azure[\s\S]{0,120}hosting platform\s*\(client override\)/i.test(
        prompt
      ) ||
      /\bmicrosoft\s+azure\b[\s\S]{0,80}\baks\b/i.test(prompt)
    ) {
      out.cloud = 'azure';
    } else if (
      /oracle cloud infrastructure[\s\S]{0,200}hosting platform\s*\(client override\)/i.test(
        prompt
      )
    ) {
      out.cloud = 'oracle';
    } else if (
      /google cloud[\s\S]{0,120}hosting platform\s*\(client override\)/i.test(prompt)
    ) {
      out.cloud = 'gcp';
    } else if (
      /\baws\b[\s\S]{0,120}hosting platform\s*\(client override\)/i.test(prompt) ||
      /amazon web services[\s\S]{0,120}hosting platform\s*\(client override\)/i.test(
        prompt
      )
    ) {
      out.cloud = 'aws';
    }
  }

  const hostingMatch = prompt.match(
    /hosting platform\s*\(client override\)\s*:\s*([^.\n]+)/i
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

  const ciMatch = prompt.match(/ci\/cd system\s*\(client override\)\s*:\s*([^.\n]+)/i);
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
    /oracle cloud infrastructure[\s\S]{0,200}hosting platform\s*\(client override\)\s*:[^.\n]*(oke|oracle kubernetes)/i.test(
      prompt
    )
  ) {
    out.cloud = 'oracle';
    out.orchestrator = 'oke';
  }

  if (
    /microsoft\s+azure[\s\S]{0,200}hosting platform\s*\(client override\)\s*:[^.\n]*(aks|azure kubernetes)/i.test(
      prompt
    )
  ) {
    out.cloud = 'azure';
    out.orchestrator = 'aks';
  }

  return out;
}

/**
 * Infer cloud / orchestrator / CI from free-text when the user names them explicitly.
 * Used so silent UI defaults (aws/eks/github-actions) do not override a clear prompt.
 */
export function inferPresetsFromPrompt(prompt: string, current: Presets): Presets {
  const t = prompt.toLowerCase();
  const overrides = parseClientOverrides(prompt);
  let cloud = overrides.cloud ?? current.cloud;
  let orchestrator = overrides.orchestrator ?? current.orchestrator;
  let ci = overrides.ci ?? current.ci;

  const mentionsAzure =
    /\bazure\b/.test(t) ||
    /\baks\b/.test(t) ||
    /container\s*apps?/.test(t) ||
    /\bazurerm\b/.test(t);
  const mentionsAws =
    /\baws\b/.test(t) ||
    /\beks\b/.test(t) ||
    /\becs\b/.test(t) ||
    /\bfargate\b/.test(t);
  const mentionsGcp =
    /\bgcp\b/.test(t) ||
    /\bgke\b/.test(t) ||
    /google\s*cloud/.test(t) ||
    /cloud\s*run/.test(t);
  const mentionsOracle =
    /\boracle\b/.test(t) ||
    /\boci\b/.test(t) ||
    /\boke\b/.test(t);

  /** True when the user named a cloud/orchestrator — not silent UI defaults. */
  const namedCloud =
    mentionsAzure || mentionsAws || mentionsGcp || mentionsOracle;

  if (!overrides.cloud) {
    if (mentionsAzure && !mentionsAws && !mentionsGcp && !mentionsOracle) {
      cloud = 'azure';
    } else if (mentionsAws && !mentionsAzure && !mentionsGcp && !mentionsOracle) {
      cloud = 'aws';
    } else if (mentionsGcp && !mentionsAzure && !mentionsAws && !mentionsOracle) {
      cloud = 'gcp';
    } else if (mentionsOracle && !mentionsAzure && !mentionsAws && !mentionsGcp) {
      cloud = 'oracle';
    }
  }

  if (!overrides.orchestrator) {
    if (namedCloud && cloud === 'azure') {
      // AKS / Kubernetes must win over a generic "container" word and UI defaults.
      if (/\baks\b/.test(t) || /azure\s+kubernetes/.test(t) || /kubernetes\s+service/.test(t)) {
        orchestrator = 'aks';
      } else if (/container\s*apps?/.test(t) || /serverless\s*containers?/.test(t)) {
        orchestrator = 'container-apps';
      } else if (/kubernetes/.test(t) || /\bk8s\b/.test(t)) {
        orchestrator = 'aks';
      } else if (orchestrator !== 'aks' && orchestrator !== 'container-apps') {
        orchestrator = 'container-apps';
      }
    } else if (namedCloud && cloud === 'aws') {
      if (/\becs\b/.test(t) || /\bfargate\b/.test(t)) orchestrator = 'ecs';
      else if (/\beks\b/.test(t) || /kubernetes/.test(t) || /\bk8s\b/.test(t)) {
        orchestrator = 'eks';
      }
    } else if (namedCloud && cloud === 'gcp') {
      if (/cloud\s*run/.test(t)) orchestrator = 'cloud-run';
      else if (/\bgke\b/.test(t) || /kubernetes/.test(t)) orchestrator = 'gke';
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

  return {
    cloud: cloud as CloudProvider,
    orchestrator: orchestrator as Orchestrator,
    ci: ci as CIProvider,
  };
}

/** True when the prompt itself names a cloud/orchestrator (not UI defaults alone). */
export function promptNamesCloud(prompt: string): boolean {
  const t = prompt.toLowerCase();
  return (
    /\b(aws|azure|gcp|oci|oracle|eks|gke|aks|oke|ecs|fargate|lambda|container\s*apps?|cloud\s*run|google\s*cloud)\b/.test(
      t
    )
  );
}
