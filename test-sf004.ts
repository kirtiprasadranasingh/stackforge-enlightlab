import { mergeLockedBaseFiles } from './lib/scaffold-base-files';
import { applyScaffoldOptions } from './lib/apply-scaffold-options';
import { normalizeScaffoldFiles } from './lib/normalize-scaffold';
import { validateScaffoldContract } from './lib/scaffold-contract';
import { detectScaffoldProfile } from './lib/scaffold-spec';

async function run() {
  const presets = { cloud: 'gcp' as const, orchestrator: 'gke' as const, ci: 'gitlab-ci' as const };
  const options = {
    region: 'europe-west1',
    access: 'public' as const,
    database: 'mysql' as const,
    databaseMode: 'provisioned' as const,
    runtime: 'java' as const,
    environments: ['production'],
  } as any;

  const profile = detectScaffoldProfile('', presets);
  if (!profile) {
    throw new Error('Profile not found');
  }

  const initialFiles = mergeLockedBaseFiles([], profile, {
    fillMissing: true,
    forceStubs: true,
    presets,
    scaffoldOptions: options
  });

  const filesArray1 = initialFiles.files;

  // mergeLockedBaseFiles ALREADY calls applyScaffoldOptions if options are provided.
  // normalizeScaffoldFiles takes Iterable<GeneratedFile>
  const normalizedArray = normalizeScaffoldFiles(filesArray1, { presets, scaffoldOptions: options, terraformOnly: true });

  console.log("PATHS BEFORE NORMALIZE:", filesArray1.map(f => f.path));

  const gitlabCi = normalizedArray.find(f => f.path === '.gitlab-ci.yml');
  const valuesYaml = normalizedArray.find(f => f.path === 'charts/app/values.yaml');
  console.log("=== .gitlab-ci.yml ===");
  console.log(gitlabCi?.content);
  console.log("=== charts/app/values.yaml ===");
  console.log(valuesYaml?.content);
  console.log("===============================");

  const report = await validateScaffoldContract(normalizedArray, presets, options);
  console.log("PATHS AFTER NORMALIZE:", normalizedArray.map(f => f.path));

  console.log(JSON.stringify(report, null, 2));
}

run().catch(console.error);
