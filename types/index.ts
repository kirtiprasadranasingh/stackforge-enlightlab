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
export type CIProvider = 'github-actions' | 'gitlab-ci' | 'jenkins';

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

export interface GenerateRequest {
  prompt: string;
  presets: Presets;
}

export interface StreamEvent {
  type: 'status' | 'file' | 'summary' | 'warnings' | 'done' | 'error';
  file?: GeneratedFile;
  content?: string;
  message?: string;
  summary?: string;
  warnings?: string[];
  error?: string;
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
  { value: 'github-actions', label: 'GitHub Actions', description: 'CI/CD with GitHub' },
  { value: 'gitlab-ci', label: 'GitLab CI', description: 'CI/CD with GitLab' },
  { value: 'jenkins', label: 'Jenkins', description: 'Traditional Jenkins pipelines' },
];
