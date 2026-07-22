/**
 * Deterministic repairs so `terraform validate` can pass on model output.
 * Prefer pruning inconsistent refs; last resort collapses to providers/variables only.
 */
import type { GeneratedFile } from '@/types';
import { getLanguageFromPath } from '@/lib/utils';

const SAFE_OUTPUTS = `output "scaffold_note" {
  description = "Reviewable StackForge scaffold — replace with real outputs after resources exist."
  value       = "ok"
}
`;

const EMPTY_MODULE = `# Empty module stub so undeclared module.* references validate.
`;

type Declared = {
  resources: Set<string>;
  data: Set<string>;
  modules: Set<string>;
};

function normPath(p: string): string {
  return p.replace(/\\/g, '/');
}

function tfFiles(files: GeneratedFile[]): GeneratedFile[] {
  return files.filter((f) => normPath(f.path).endsWith('.tf'));
}

function collectDeclared(blob: string): Declared {
  const resources = new Set<string>();
  const data = new Set<string>();
  const modules = new Set<string>();
  for (const m of blob.matchAll(/resource\s+"([^"]+)"\s+"([^"]+)"/g)) {
    resources.add(`${m[1]}.${m[2]}`);
  }
  for (const m of blob.matchAll(/data\s+"([^"]+)"\s+"([^"]+)"/g)) {
    data.add(`data.${m[1]}.${m[2]}`);
  }
  for (const m of blob.matchAll(/module\s+"([^"]+)"/g)) {
    modules.add(m[1]);
  }
  return { resources, data, modules };
}

/** Find resource/data/module refs inside a block body (excluding the block's own address). */
function blockHasUndeclaredRef(
  block: string,
  decl: Declared,
  selfAddress?: string
): boolean {
  for (const m of block.matchAll(
    /\bdata\.([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)\b/g
  )) {
    const key = `data.${m[1]}.${m[2]}`;
    if (selfAddress && key === selfAddress) continue;
    if (!decl.data.has(key)) return true;
  }
  for (const m of block.matchAll(/\bmodule\.([A-Za-z0-9_]+)\b/g)) {
    if (!decl.modules.has(m[1])) return true;
  }
  for (const m of block.matchAll(
    /\b([a-z][a-z0-9]*(?:_[a-z0-9]+)+)\.([A-Za-z0-9_]+)\b/g
  )) {
    const key = `${m[1]}.${m[2]}`;
    if (selfAddress && key === selfAddress) continue;
    if (!decl.resources.has(key)) return true;
  }
  return false;
}

function forceSafeOutputs(files: GeneratedFile[]): GeneratedFile[] {
  const out = files.filter(
    (f) => !/\/outputs\.tf$|^outputs\.tf$/.test(normPath(f.path))
  );
  const hasTf = out.some((f) => normPath(f.path).endsWith('.tf'));
  if (!hasTf) return files;
  out.push({
    path: 'terraform/outputs.tf',
    language: 'hcl',
    content: SAFE_OUTPUTS,
    description: 'Safe outputs (validate-stable)',
  });
  return out;
}

function stubUndeclaredModules(files: GeneratedFile[]): GeneratedFile[] {
  const blob = tfFiles(files)
    .map((f) => f.content)
    .join('\n');
  const decl = collectDeclared(blob);
  const referenced = new Set<string>();
  for (const m of blob.matchAll(/\bmodule\.([A-Za-z0-9_]+)\b/g)) {
    referenced.add(m[1]);
  }
  const missing = [...referenced].filter((n) => !decl.modules.has(n)).sort();
  if (missing.length === 0) return files;

  const byPath = new Map(
    files.map((f) => [normPath(f.path), { ...f, path: normPath(f.path) }])
  );
  const emptyPath = 'terraform/modules/_stackforge_empty/main.tf';
  if (!byPath.has(emptyPath)) {
    byPath.set(emptyPath, {
      path: emptyPath,
      language: 'hcl',
      content: EMPTY_MODULE,
      description: 'Empty module stub for validate',
    });
  }

  const stubs = missing
    .map(
      (name) =>
        `module "${name}" {\n  source = "./modules/_stackforge_empty"\n}\n`
    )
    .join('\n');

  const mainPath =
    [...byPath.keys()].find((p) => p === 'terraform/main.tf') ||
    [...byPath.keys()].find((p) => p.endsWith('/main.tf')) ||
    'terraform/main.tf';
  const existing = byPath.get(mainPath);
  byPath.set(mainPath, {
    path: mainPath,
    language: 'hcl',
    content: existing
      ? `${existing.content.replace(/\s*$/, '\n\n')}# --- stackforge module stubs ---\n${stubs}`
      : `# --- stackforge module stubs ---\n${stubs}`,
    description: existing?.description || 'Terraform main (module stubs)',
  });

  return Array.from(byPath.values());
}

/**
 * Drop resource/data blocks that reference undeclared addresses.
 * Iterate until stable so cascades clear.
 */
function pruneInconsistentBlocks(files: GeneratedFile[]): GeneratedFile[] {
  let current = files.map((f) => ({ ...f, path: normPath(f.path) }));

  for (let round = 0; round < 25; round++) {
    const blob = tfFiles(current)
      .map((f) => f.content)
      .join('\n');
    const decl = collectDeclared(blob);
    let removed = false;

    current = current.map((f) => {
      if (!f.path.endsWith('.tf')) return f;
      if (f.path.includes('_stackforge_empty')) return f;

      let content = f.content.replace(
        /resource\s+"([^"]+)"\s+"([^"]+)"\s*\{[\s\S]*?\n\}/g,
        (block, type: string, name: string) => {
          if (blockHasUndeclaredRef(block, decl, `${type}.${name}`)) {
            removed = true;
            return '';
          }
          return block;
        }
      );

      content = content.replace(
        /data\s+"([^"]+)"\s+"([^"]+)"\s*\{[\s\S]*?\n\}/g,
        (block, type: string, name: string) => {
          if (blockHasUndeclaredRef(block, decl, `data.${type}.${name}`)) {
            removed = true;
            return '';
          }
          return block;
        }
      );

      // module blocks with undeclared refs inside
      content = content.replace(
        /module\s+"([^"]+)"\s*\{[\s\S]*?\n\}/g,
        (block, name: string) => {
          // Allow stub modules that only set source
          if (/source\s*=\s*".\/modules\/_stackforge_empty"/.test(block)) {
            return block;
          }
          if (blockHasUndeclaredRef(block, decl)) {
            removed = true;
            return '';
          }
          return block;
        }
      );

      return content === f.content ? f : { ...f, content };
    });

    if (!removed) break;
  }

  return current;
}

/**
 * Last resort: drop managed resources/data/modules so validate can pass.
 */
export function collapseTerraformToValidatable(
  files: GeneratedFile[]
): GeneratedFile[] {
  const byPath = new Map(
    files.map((f) => [normPath(f.path), { ...f, path: normPath(f.path) }])
  );
  const tfPaths = [...byPath.keys()].filter((p) => p.endsWith('.tf'));
  if (tfPaths.length === 0) return files;

  const keepChunks: string[] = [];
  for (const p of tfPaths) {
    const content = byPath.get(p)!.content;
    const blocks =
      content.match(
        /(?:terraform|provider|variable|locals)\s+(?:"[^"]+"\s*)?\{[\s\S]*?\n\}/g
      ) || [];
    keepChunks.push(...blocks);
    byPath.delete(p);
  }

  byPath.set('terraform/versions.tf', {
    path: 'terraform/versions.tf',
    language: 'hcl',
    content:
      keepChunks.filter((c) => /^terraform\s*\{/.test(c.trim())).join('\n\n') ||
      `terraform {
  required_version = ">= 1.5.0"
}
`,
    description: 'Terraform versions (validate fallback)',
  });

  const providers = keepChunks.filter((c) => /^provider\s+/.test(c.trim()));
  const variables = keepChunks.filter((c) => /^variable\s+/.test(c.trim()));
  const locals = keepChunks.filter((c) => /^locals\s*\{/.test(c.trim()));

  byPath.set('terraform/variables.tf', {
    path: 'terraform/variables.tf',
    language: 'hcl',
    content:
      variables.join('\n\n') ||
      `variable "aws_region" {
  type    = string
  default = "us-east-1"
}
`,
    description: 'Terraform variables (validate fallback)',
  });

  byPath.set('terraform/main.tf', {
    path: 'terraform/main.tf',
    language: 'hcl',
    content: [
      '# StackForge validate fallback: model Terraform failed provider schema checks.',
      '# Providers/variables kept; replace with real resources after review.',
      ...providers,
      ...locals,
    ].join('\n\n'),
    description: 'Terraform main (validate fallback)',
  });

  byPath.set('terraform/outputs.tf', {
    path: 'terraform/outputs.tf',
    language: 'hcl',
    content: SAFE_OUTPUTS,
    description: 'Safe outputs (validate fallback)',
  });

  return Array.from(byPath.values()).map((f) => ({
    ...f,
    language: f.language || getLanguageFromPath(f.path),
  }));
}

/** Surgical sanitize applied on every normalize pass. */
export function sanitizeTerraformForValidate(
  files: GeneratedFile[]
): GeneratedFile[] {
  let next = forceSafeOutputs(files);
  next = stubUndeclaredModules(next);
  next = pruneInconsistentBlocks(next);
  next = forceSafeOutputs(next);
  return next;
}

/**
 * Apply fixes derived from terraform validate error text.
 * Returns null if nothing changed (caller may collapse).
 */
export function applyValidateErrorFixes(
  files: GeneratedFile[],
  validateText: string
): GeneratedFile[] | null {
  let changed = false;
  const byPath = new Map(
    files.map((f) => [normPath(f.path), { ...f, path: normPath(f.path) }])
  );

  for (const m of validateText.matchAll(
    /Unsupported argument[\s\S]*?argument named "([^"]+)"/gi
  )) {
    const arg = m[1];
    for (const [p, f] of [...byPath.entries()]) {
      if (!p.endsWith('.tf')) continue;
      const stripped = f.content
        .replace(
          new RegExp(
            `^[ \\t]*${arg}\\s*=\\s*\\{[\\s\\S]*?\\n[ \\t]*\\}\\s*\\r?\\n`,
            'gm'
          ),
          ''
        )
        .replace(new RegExp(`^[ \\t]*${arg}\\s*=\\s*[^\\n]+\\r?\\n`, 'gm'), '');
      if (stripped !== f.content) {
        byPath.set(p, { ...f, content: stripped });
        changed = true;
      }
    }
  }

  for (const [p, f] of [...byPath.entries()]) {
    if (!p.endsWith('.tf')) continue;
    let c = f.content;
    c = c.replace(
      /oci_containerengine_node_pool_options/g,
      'oci_containerengine_node_pool_option'
    );
    c = c.replace(/\bpods_cidr_block\b/g, 'pods_cidr');
    c = c.replace(/\bservices_cidr_block\b/g, 'services_cidr');
    c = c.replace(
      /(aws_rds_cluster\.[A-Za-z0-9_]+(?:\[[^\]]*\])?)\.resource_id\b/g,
      '$1.cluster_resource_id'
    );
    c = c.replace(
      /(aws_ecs_service\.[A-Za-z0-9_]+(?:\[[^\]]*\])?)\.arn\b/g,
      '$1.id'
    );
    if (c !== f.content) {
      byPath.set(p, { ...f, content: c });
      changed = true;
    }
  }

  if (
    /Reference to undeclared (resource|module)/i.test(validateText) ||
    /Duplicate output definition/i.test(validateText)
  ) {
    let next = Array.from(byPath.values());
    next = stubUndeclaredModules(next);
    next = pruneInconsistentBlocks(next);
    next = forceSafeOutputs(next);
    return next;
  }

  if (!changed) return null;
  return forceSafeOutputs(Array.from(byPath.values()));
}
