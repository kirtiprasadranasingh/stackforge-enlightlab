import type { CIProvider, CloudProvider, Orchestrator, Presets } from '@/types';

/**
 * Infer cloud / orchestrator / CI from free-text when the user names them explicitly.
 * Used so silent UI defaults (aws/eks/github-actions) do not override a clear prompt.
 */
export function inferPresetsFromPrompt(prompt: string, current: Presets): Presets {
  const t = prompt.toLowerCase();
  let cloud = current.cloud;
  let orchestrator = current.orchestrator;
  let ci = current.ci;

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

  if (mentionsAzure && !mentionsAws && !mentionsGcp && !mentionsOracle) {
    cloud = 'azure';
  } else if (mentionsAws && !mentionsAzure && !mentionsGcp && !mentionsOracle) {
    cloud = 'aws';
  } else if (mentionsGcp && !mentionsAzure && !mentionsAws && !mentionsOracle) {
    cloud = 'gcp';
  } else if (mentionsOracle && !mentionsAzure && !mentionsAws && !mentionsGcp) {
    cloud = 'oracle';
  }

  if (cloud === 'azure') {
    if (/container\s*apps?/.test(t) || /serverless\s*containers?/.test(t)) {
      orchestrator = 'container-apps';
    } else if (/\baks\b/.test(t) || /kubernetes/.test(t) || /\bk8s\b/.test(t)) {
      orchestrator = 'aks';
    } else if (orchestrator !== 'aks' && orchestrator !== 'container-apps') {
      orchestrator = 'container-apps';
    }
  } else if (cloud === 'aws') {
    if (/\becs\b/.test(t) || /\bfargate\b/.test(t)) orchestrator = 'ecs';
    else if (/\beks\b/.test(t) || /kubernetes/.test(t) || /\bk8s\b/.test(t)) orchestrator = 'eks';
  } else if (cloud === 'gcp') {
    if (/cloud\s*run/.test(t)) orchestrator = 'cloud-run';
    else if (/\bgke\b/.test(t) || /kubernetes/.test(t)) orchestrator = 'gke';
  } else if (cloud === 'oracle') {
    orchestrator = 'oke';
  }

  if (/azure\s*devops|azure\s*pipelines|\bazdo\b/.test(t)) {
    ci = 'azure-devops';
  } else if (/gitlab(\s*ci)?/.test(t)) {
    ci = 'gitlab-ci';
  } else if (/\bjenkins\b/.test(t)) {
    ci = 'jenkins';
  } else if (/github\s*actions|\.github\/workflows/.test(t)) {
    ci = 'github-actions';
  }

  return {
    cloud: cloud as CloudProvider,
    orchestrator: orchestrator as Orchestrator,
    ci: ci as CIProvider,
  };
}
