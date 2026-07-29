/** Deterministic checks for the final generated file set. */
import type { GeneratedFile, Presets } from '@/types';
import type { ScaffoldOptions } from '@/lib/scaffold-options';

function content(files: GeneratedFile[], path: string): string {
  return files.find((file) => file.path === path)?.content || '';
}

export function validateScaffoldContract(
  files: GeneratedFile[],
  presets: Presets,
  options: ScaffoldOptions
): string[] {
  const issues: string[] = [];
  const paths = new Set(files.map((file) => file.path));
  const runtime = options.runtime;

  if (runtime === 'python') {
    if (!paths.has('app/main.py') || !paths.has('app/requirements.txt')) {
      issues.push('Python runtime is missing its application files.');
    }
    for (const path of ['app/server.js', 'app/package.json', 'app/package-lock.json']) {
      if (paths.has(path)) issues.push(`Python runtime contains conflicting Node file ${path}.`);
    }
  }
  if (runtime === 'node') {
    if (!paths.has('app/server.js') || !paths.has('app/package.json')) {
      issues.push('Node.js runtime is missing its application files.');
    }
    for (const path of ['app/main.py', 'app/requirements.txt', 'app/main.go', 'app/go.mod']) {
      if (paths.has(path)) issues.push(`Node.js runtime contains conflicting file ${path}.`);
    }
  }
  if (runtime === 'java') {
    const java = content(files, 'app/src/main/java/com/example/health/Application.java');
    const pom = content(files, 'app/pom.xml');
    if (!java || !pom) issues.push('Java runtime is missing its minimal health-service files.');
    if (/springframework|spring-boot/i.test(`${java}\n${pom}`)) {
      issues.push('Java-only selection introduced Spring Boot without a framework choice.');
    }
  }

  if (presets.cloud === 'aws' && presets.orchestrator === 'ecs') {
    const variables = content(files, 'terraform/variables.tf');
    const ecs = content(files, 'terraform/ecs.tf');
    const docker = content(files, 'app/Dockerfile');
    const workflow = content(files, '.github/workflows/deploy.yml');
    const expectedPort = runtime === 'node' ? 3000 : 8080;

    if (!new RegExp(`variable\\s+"container_port"[\\s\\S]*?default\\s*=\\s*${expectedPort}`).test(variables)) {
      issues.push(`ECS container_port is not ${expectedPort} for the ${runtime} runtime.`);
    }
    if (!new RegExp(`EXPOSE\\s+${expectedPort}`).test(docker)) {
      issues.push(`Dockerfile does not expose the ECS port ${expectedPort}.`);
    }
    if (runtime === 'python' && /node\s+-e/i.test(ecs)) {
      issues.push('Python ECS task definition still executes a Node.js health check.');
    }
    if (runtime === 'python' && !/python\s+-c/i.test(ecs)) {
      issues.push('Python ECS task definition is missing a Python health check.');
    }
    if (presets.ci === 'github-actions') {
      if (!/register-task-definition/i.test(workflow) || !/--task-definition/i.test(workflow)) {
        issues.push('ECS workflow pushes an image without registering/deploying a new task definition.');
      }
      if (!/amazon-ecr-login/i.test(workflow)) {
        issues.push('AWS ECS workflow does not use Amazon ECR.');
      }
    }
  }

  const redisIsProvisioned =
    (presets.cloud === 'aws' && presets.orchestrator === 'ecs') ||
    (presets.cloud === 'gcp' && presets.orchestrator === 'cloud-run') ||
    (presets.cloud === 'azure' && presets.orchestrator === 'aks');
  if (options.database === 'redis' && redisIsProvisioned) {
    const tfvars = files
      .filter((file) => file.path.startsWith('environments/') && file.path.endsWith('.tfvars'))
      .map((file) => file.content)
      .join('\n');
    if (!/enable_redis\s*=\s*true/.test(tfvars) || /enable_database\s*=\s*true/.test(tfvars)) {
      issues.push('Redis selection is not reflected consistently in environment tfvars.');
    }
  }
  if (options.database === 'none') {
    if (files.some((file) => /terraform\/(database|redis|mongodb)\.tf$/.test(file.path))) {
      issues.push('No-data-service scaffold still contains a database/cache Terraform file.');
    }
  }
  if (options.database === 'mongodb') {
    const tfvars = files
      .filter((file) => file.path.startsWith('environments/') && file.path.endsWith('.tfvars'))
      .map((file) => file.content)
      .join('\n');
    if (!/enable_database\s*=\s*false/.test(tfvars)) {
      issues.push('Unsupported MongoDB selection must not enable a substitute database.');
    }
  }

  return [...new Set(issues)];
}
