// Shared TypeScript types for StackForge

export type CloudProvider = 'oracle' | 'aws' | 'gcp' | 'azure';
export type Orchestrator =
  | 'oke'
  | 'eks'
  | 'gke'
  | 'aks'
  | 'ecs'
  | 'serverless'
  | 'cloud-run'
  | 'container-apps';
export type CIProvider =
  | 'github-actions'
  | 'gitlab-ci'
  | 'jenkins'
  | 'azure-devops'
  | 'aws-codepipeline'
  | 'gcp-cloud-build'
  | 'oci-devops';

export interface Presets {
  cloud: CloudProvider;
  orchestrator: Orchestrator;
  ci: CIProvider;
}

export interface GeneratedFile {
  path: string;
  language: string;
  content: string;
  description?: string;
}

export interface GenerationResult {
  files: GeneratedFile[];
  summary?: string;
  warnings?: string[];
}

export type WorkflowPhase = 'clarify' | 'plan' | 'generate';

export interface GenerateRequest {
  prompt: string;
  presets: Presets;
  /** Workflow phase — plan/clarify never emit files; generate creates artifacts */
  phase?: WorkflowPhase;
  /** Approved architecture plan required for gated generate */
  approvedPlan?: string;
  /** Prior plan text when the user is revising */
  priorPlan?: string;
}

export interface StreamEvent {
  type:
    | 'status'
    | 'file'
    | 'summary'
    | 'warnings'
    | 'done'
    | 'error'
    | 'clear'
    | 'delete'
    | 'questions'
    | 'plan';
  file?: GeneratedFile;
  path?: string;
  content?: string;
  message?: string;
  summary?: string;
  warnings?: string[];
  error?: string;
  questions?: string[];
  plan?: string;
}

export interface RateLimitInfo {
  limit: number;
  remaining: number;
  resetAt: Date;
}

export interface GenerationResponse {
  success: boolean;
  result?: GenerationResult;
  error?: string;
  rateLimit?: RateLimitInfo;
}

export interface PresetOption {
  value: string;
  label: string;
  description: string;
}

export const CLOUD_OPTIONS: PresetOption[] = [
  { value: 'oracle', label: 'Oracle Cloud', description: 'Oracle Cloud Infrastructure' },
  { value: 'aws', label: 'AWS', description: 'Amazon Web Services' },
  { value: 'gcp', label: 'GCP', description: 'Google Cloud Platform' },
  { value: 'azure', label: 'Azure', description: 'Microsoft Azure' },
];

export const ORCHESTRATOR_OPTIONS: Record<CloudProvider, PresetOption[]> = {
  oracle: [
    { value: 'oke', label: 'OKE', description: 'Oracle Container Engine for Kubernetes' },
  ],
  aws: [
    { value: 'eks', label: 'EKS', description: 'Elastic Kubernetes Service' },
    { value: 'ecs', label: 'ECS', description: 'Elastic Container Service' },
  ],
  gcp: [
    { value: 'gke', label: 'GKE', description: 'Google Kubernetes Engine' },
    { value: 'cloud-run', label: 'Cloud Run', description: 'Serverless containers' },
  ],
  azure: [
    { value: 'aks', label: 'AKS', description: 'Azure Kubernetes Service' },
    { value: 'container-apps', label: 'Container Apps', description: 'Serverless containers' },
  ],
};

export const CI_OPTIONS: PresetOption[] = [
  {
    value: 'github-actions',
    label: 'GitHub Actions',
    description: 'GitHub workflows — works with AWS, GCP, Azure, OCI',
  },
  {
    value: 'gitlab-ci',
    label: 'GitLab CI',
    description: 'GitLab pipelines (.gitlab-ci.yml)',
  },
  {
    value: 'jenkins',
    label: 'Jenkins',
    description: 'Jenkinsfile declarative pipelines',
  },
  {
    value: 'azure-devops',
    label: 'Azure DevOps',
    description: 'Azure Pipelines YAML',
  },
  {
    value: 'aws-codepipeline',
    label: 'AWS CodePipeline',
    description: 'CodeBuild buildspec + CodePipeline (AWS-native)',
  },
  {
    value: 'gcp-cloud-build',
    label: 'Google Cloud Build',
    description: 'cloudbuild.yaml (GCP-native)',
  },
  {
    value: 'oci-devops',
    label: 'OCI DevOps',
    description: 'Oracle DevOps build/deploy pipelines',
  },
];

/** Preferred CI order for setup / interview options per cloud (all still available). */
export const CI_OPTIONS_BY_CLOUD: Record<CloudProvider, CIProvider[]> = {
  aws: [
    'github-actions',
    'aws-codepipeline',
    'gitlab-ci',
    'jenkins',
    'azure-devops',
    'gcp-cloud-build',
    'oci-devops',
  ],
  gcp: [
    'gitlab-ci',
    'gcp-cloud-build',
    'github-actions',
    'jenkins',
    'azure-devops',
    'aws-codepipeline',
    'oci-devops',
  ],
  azure: [
    'azure-devops',
    'github-actions',
    'gitlab-ci',
    'jenkins',
    'aws-codepipeline',
    'gcp-cloud-build',
    'oci-devops',
  ],
  oracle: [
    'github-actions',
    'oci-devops',
    'gitlab-ci',
    'jenkins',
    'azure-devops',
    'aws-codepipeline',
    'gcp-cloud-build',
  ],
};
