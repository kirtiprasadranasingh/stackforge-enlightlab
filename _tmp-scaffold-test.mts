import { parseScaffoldOptions } from './lib/scaffold-options.ts';
import { getProfileBaseFiles, mergeLockedBaseFiles } from './lib/scaffold-base-files.ts';
import { GCP_FASTAPI_CLOUDRUN_PROFILE } from './lib/scaffold-spec.ts';
import * as fs from 'fs';
import * as path from 'path';

const presets = { cloud: 'gcp', orchestrator: 'cloud-run', ci: 'gitlab-ci' };
const text = `Python FastAPI GCP Cloud Run GitLab CI Cloud SQL PostgreSQL us-central1 Development and staging Public without a custom domain Private database with 7-day automatic backups IAM least privilege`;
const opts = parseScaffoldOptions(text, presets);
console.log(JSON.stringify(opts, null, 2));
const base = Object.entries(getProfileBaseFiles('gcp-fastapi-cloudrun')).map(([p, content]) => ({ path: p, content }));
const { files } = mergeLockedBaseFiles(base, GCP_FASTAPI_CLOUDRUN_PROFILE, { forceStubs: true, presets, scaffoldOptions: opts });
const vars = files.find((f) => f.path === 'terraform/variables.tf')!.content;
const db = files.find((f) => f.path === 'terraform/database.tf')!.content;
const cr = files.find((f) => f.path === 'terraform/cloudrun.tf')!.content;
const iam = files.find((f) => f.path === 'terraform/iam.tf')!.content;
console.log('postgres default', /default = "postgres"/.test(vars));
console.log('backup 7', /retained_backups = var.backup_retention_count/.test(db));
console.log('public allUsers', /allUsers/.test(cr) && /allow_public_access/.test(cr));
console.log('iam gitlab', /gitlab_ci/.test(iam));
console.log('gitlab only', files.some((f) => f.path === '.gitlab-ci.yml') && !files.some((f) => f.path.includes('.github')));
console.log('main.py', files.some((f) => f.path === 'main.py'));
console.log('envs', files.filter((f) => f.path.startsWith('environments/')).map((f) => f.path).join(','));
const stg = files.find((f) => f.path === 'environments/staging.tfvars')!.content;
console.log('tfvars postgres', stg.includes('db_engine = "postgres"'));

const tmpDir = path.join(process.cwd(), '_tmp-terraform-validate');
fs.rmSync(tmpDir, { recursive: true, force: true });
fs.mkdirSync(path.join(tmpDir, 'terraform'), { recursive: true });
for (const f of files) {
  if (f.path.startsWith('terraform/')) {
    const rel = f.path.slice('terraform/'.length);
    const dest = path.join(tmpDir, 'terraform', rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, f.content);
  }
}
console.log('WROTE_TERRAFORM_TO', tmpDir);
