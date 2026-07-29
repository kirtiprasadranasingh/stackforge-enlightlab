/** Deterministic checks for the final generated file set. */
import type { GeneratedFile, Presets } from '@/types';
import type { ScaffoldOptions } from '@/lib/scaffold-options';

function content(files: GeneratedFile[], path: string): string {
  return files.find((file) => file.path === path)?.content || '';
}

function hasAnyPath(paths: Set<string>, candidates: string[]): boolean {
  return candidates.some((path) => paths.has(path));
}

function contentAtAnyPath(files: GeneratedFile[], candidates: string[]): string {
  return candidates.map((path) => content(files, path)).find(Boolean) || '';
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
    if (
      !hasAnyPath(paths, ['app/main.py', 'main.py']) ||
      !hasAnyPath(paths, ['app/requirements.txt', 'requirements.txt'])
    ) {
      issues.push('Python runtime is missing its application files.');
    }
    for (const path of [
      'app/server.js',
      'app/package.json',
      'app/package-lock.json',
      'server.js',
      'package.json',
      'package-lock.json',
    ]) {
      if (paths.has(path)) issues.push(`Python runtime contains conflicting Node file ${path}.`);
    }
  }
  if (runtime === 'node') {
    if (
      !hasAnyPath(paths, ['app/server.js', 'server.js']) ||
      !hasAnyPath(paths, ['app/package.json', 'package.json'])
    ) {
      issues.push('Node.js runtime is missing its application files.');
    }
    for (const path of [
      'app/main.py',
      'app/requirements.txt',
      'app/main.go',
      'app/go.mod',
      'main.py',
      'requirements.txt',
      'main.go',
      'go.mod',
    ]) {
      if (paths.has(path)) issues.push(`Node.js runtime contains conflicting file ${path}.`);
    }
  }
  if (runtime === 'java') {
    const java = contentAtAnyPath(files, [
      'app/src/main/java/com/example/health/Application.java',
      'src/main/java/com/example/health/Application.java',
    ]);
    const pom = contentAtAnyPath(files, ['app/pom.xml', 'pom.xml']);
    const docker = contentAtAnyPath(files, ['app/Dockerfile', 'Dockerfile']);
    if (!java || !pom) issues.push('Java runtime is missing its minimal health-service files.');
    if (/springframework|spring-boot/i.test(`${java}\n${pom}`)) {
      issues.push('Java-only selection introduced Spring Boot without a framework choice.');
    }
    if (!/com\.sun\.net\.httpserver|\/health/.test(java)) {
      issues.push('Java runtime does not implement the required /health endpoint.');
    }
    if (!/FROM\s+maven:|FROM\s+eclipse-temurin:/i.test(docker) || !/EXPOSE\s+8080/.test(docker)) {
      issues.push('Java runtime Dockerfile must build Java and expose port 8080.');
    }
    for (const path of [
      'app/server.js',
      'app/package.json',
      'app/package-lock.json',
      'server.js',
      'package.json',
      'package-lock.json',
    ]) {
      if (paths.has(path)) issues.push(`Java runtime contains conflicting Node file ${path}.`);
    }
  }

  if (presets.cloud === 'aws' && presets.orchestrator === 'eks') {
    const workflow = content(files, '.github/workflows/deploy.yml');
    const values = content(files, 'charts/app/values.yaml');
    if (runtime === 'java' && !/targetPort:\s*8080/.test(values)) {
      issues.push('EKS Helm values do not route to Java port 8080.');
    }
    if (presets.ci === 'github-actions') {
      for (const required of ['amazon-ecr-login', 'docker build', 'docker push', '--set image.repository', '--set image.tag']) {
        if (!workflow.includes(required)) {
          issues.push(`EKS GitHub Actions workflow is missing ${required}.`);
        }
      }
    }
    if (options.access !== 'private') {
      if (!/type:\s*LoadBalancer/.test(values)) {
        issues.push('Public EKS access must use a Kubernetes LoadBalancer Service.');
      }
      if (!/ingress:\s*\n\s*enabled:\s*false/m.test(values)) {
        issues.push('Public EKS default-hostname access must not retain an unconfigured ingress host.');
      }
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
    (presets.cloud === 'aws' && presets.orchestrator === 'eks') ||
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
    if (presets.cloud === 'aws' && presets.orchestrator === 'eks') {
      const redis = content(files, 'terraform/redis.tf');
      const securityGroups = content(files, 'terraform/security_groups.tf');
      const outputs = content(files, 'terraform/outputs.tf');
      if (!/aws_elasticache_replication_group/.test(redis)) {
        issues.push('EKS Redis selection is missing an ElastiCache replication group.');
      }
      if (!/aws_security_group" "redis"|aws_security_group\s+"redis"/.test(securityGroups)) {
        issues.push('EKS Redis selection is missing the private Redis security group.');
      }
      if (!/redis_primary_endpoint/.test(outputs)) {
        issues.push('EKS Redis selection is missing its application endpoint output.');
      }
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
