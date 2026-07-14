import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';

export default function HomePage() {
  return (
    <div className="min-h-screen bg-white text-gray-900 font-sans">
      <SiteHeader />

      <main className="flex-1">
        {/* Hero Section */}
        <section className="max-w-5xl mx-auto px-6 pt-20 pb-16 text-center">
          <span className="inline-block text-xs font-semibold tracking-widest text-indigo-600 uppercase mb-4">
            Free · 30 seconds · No account needed
          </span>
          <h1 className="text-4xl sm:text-5xl font-bold text-gray-900 leading-tight mb-5">
            How production-grade is <span className="text-indigo-600">your cloud stack?</span>
          </h1>
          <p className="text-lg text-gray-500 max-w-xl mx-auto mb-10 leading-relaxed">
            Describe your infrastructure in plain English and get an instant, copyable set of working configurations: Terraform files, CI/CD pipelines, and Kubernetes manifests.
          </p>
          <Link
            className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-8 py-3.5 rounded-xl text-base transition-colors shadow-sm no-underline"
            href="/generate"
          >
            Start generating free
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3"></path>
            </svg>
          </Link>

          {/* Stats Badges */}
          <div className="mt-14 grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-gray-50 rounded-xl py-4 px-3 text-center">
              <p className="text-xl font-bold text-gray-900">&lt; 30 sec</p>
              <p className="text-sm text-gray-500 mt-0.5">To generate</p>
            </div>
            <div className="bg-gray-50 rounded-xl py-4 px-3 text-center">
              <p className="text-xl font-bold text-gray-900">4 clouds</p>
              <p className="text-sm text-gray-500 mt-0.5">Supported platforms</p>
            </div>
            <div className="bg-gray-50 rounded-xl py-4 px-3 text-center">
              <p className="text-xl font-bold text-gray-900">3</p>
              <p className="text-sm text-gray-500 mt-0.5">Core artifacts</p>
            </div>
            <div className="bg-gray-50 rounded-xl py-4 px-3 text-center">
              <p className="text-xl font-bold text-gray-900">Free</p>
              <p className="text-sm text-gray-500 mt-0.5">No sign-up needed</p>
            </div>
          </div>
        </section>

        {/* Four Dimensions Measured -> What we generate */}
        <section className="bg-gray-50 border-y border-gray-100">
          <div className="max-w-5xl mx-auto px-6 py-16">
            <p className="text-xs font-semibold tracking-widest text-gray-400 uppercase text-center mb-10">
              What we generate
            </p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
              <div className="bg-white rounded-xl border border-gray-100 p-5">
                <h3 className="font-semibold text-gray-900 mb-1.5 text-sm">Infrastructure (Terraform)</h3>
                <p className="text-sm text-gray-500 leading-relaxed">
                  VCN/VPC networking, compute nodes, IAM roles, and environment setups using real, pinned provider versions.
                </p>
              </div>
              <div className="bg-white rounded-xl border border-gray-100 p-5">
                <h3 className="font-semibold text-gray-900 mb-1.5 text-sm">CI / CD Pipelines</h3>
                <p className="text-sm text-gray-500 leading-relaxed">
                  Build, test, deploy, and automated rollback workflows tailored for GitHub Actions, GitLab CI, or Jenkins pipelines.
                </p>
              </div>
              <div className="bg-white rounded-xl border border-gray-100 p-5">
                <h3 className="font-semibold text-gray-900 mb-1.5 text-sm">Containers & Orchestration</h3>
                <p className="text-sm text-gray-500 leading-relaxed">
                  Multi-stage Dockerfile templates and Helm charts complete with health probes, CPU/memory limits, and secret placeholders.
                </p>
              </div>
              <div className="bg-white rounded-xl border border-gray-100 p-5">
                <h3 className="font-semibold text-gray-900 mb-1.5 text-sm">Production Defaults</h3>
                <p className="text-sm text-gray-500 leading-relaxed">
                  Least-privilege security settings, secure environment variables, and Prometheus observability metrics wired in.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Tiers -> Supported Platforms */}
        <section className="max-w-5xl mx-auto px-6 py-16">
          <p className="text-xs font-semibold tracking-widest text-gray-400 uppercase text-center mb-3">
            Supported Cloud Environments
          </p>
          <h2 className="text-2xl font-bold text-center text-gray-900 mb-10">
            Which platforms do we support?
          </h2>
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1 rounded-xl border border-gray-100 p-4 text-center">
              <span className="inline-block text-xs font-semibold px-2.5 py-1 rounded-full mb-2 bg-red-100 text-red-700">
                AWS
              </span>
              <p className="text-sm font-mono text-gray-400">EKS · ECS · VPC</p>
            </div>
            <div className="flex-1 rounded-xl border border-gray-100 p-4 text-center">
              <span className="inline-block text-xs font-semibold px-2.5 py-1 rounded-full mb-2 bg-orange-100 text-orange-700">
                Oracle Cloud
              </span>
              <p className="text-sm font-mono text-gray-400">OKE · VCN · OCIR</p>
            </div>
            <div className="flex-1 rounded-xl border border-gray-100 p-4 text-center">
              <span className="inline-block text-xs font-semibold px-2.5 py-1 rounded-full mb-2 bg-yellow-100 text-yellow-700">
                Google Cloud
              </span>
              <p className="text-sm font-mono text-gray-400">GKE · Cloud Run</p>
            </div>
            <div className="flex-1 rounded-xl border border-gray-100 p-4 text-center">
              <span className="inline-block text-xs font-semibold px-2.5 py-1 rounded-full mb-2 bg-blue-100 text-blue-700">
                Azure
              </span>
              <p className="text-sm font-mono text-gray-400">AKS · App Gateway</p>
            </div>
            <div className="flex-1 rounded-xl border border-gray-100 p-4 text-center">
              <span className="inline-block text-xs font-semibold px-2.5 py-1 rounded-full mb-2 bg-green-100 text-green-700">
                CI / CD & K8s
              </span>
              <p className="text-sm font-mono text-gray-400">Actions · GitLab · Helm</p>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="bg-gray-50 border-y border-gray-100">
          <div className="max-w-3xl mx-auto px-6 py-16">
            <p className="text-xs font-semibold tracking-widest text-gray-400 uppercase text-center mb-10">
              How it works
            </p>
            <ol className="space-y-6">
              <li className="flex gap-5 items-start">
                <span className="flex-shrink-0 w-8 h-8 rounded-full bg-indigo-600 text-white text-sm font-bold flex items-center justify-center">
                  1
                </span>
                <div>
                  <p className="font-semibold text-gray-900">Select your presets</p>
                  <p className="text-sm text-gray-500 mt-0.5 leading-relaxed">
                    Choose your target cloud platform, container orchestrator, and CI pipeline provider to establish the environment parameters.
                  </p>
                </div>
              </li>
              <li className="flex gap-5 items-start">
                <span className="flex-shrink-0 w-8 h-8 rounded-full bg-indigo-600 text-white text-sm font-bold flex items-center justify-center">
                  2
                </span>
                <div>
                  <p className="font-semibold text-gray-900">Describe your application</p>
                  <p className="text-sm text-gray-500 mt-0.5 leading-relaxed">
                    Specify your database settings, autoscaling thresholds, load balancer configurations, and environment secrets in plain prose.
                  </p>
                </div>
              </li>
              <li className="flex gap-5 items-start">
                <span className="flex-shrink-0 w-8 h-8 rounded-full bg-indigo-600 text-white text-sm font-bold flex items-center justify-center">
                  3
                </span>
                <div>
                  <p className="font-semibold text-gray-900">Watch the code stream</p>
                  <p className="text-sm text-gray-500 mt-0.5 leading-relaxed">
                    Watch as StackForge streams back networking modules, CI configuration files, container manifests, and deployment templates.
                  </p>
                </div>
              </li>
              <li className="flex gap-5 items-start">
                <span className="flex-shrink-0 w-8 h-8 rounded-full bg-indigo-600 text-white text-sm font-bold flex items-center justify-center">
                  4
                </span>
                <div>
                  <p className="font-semibold text-gray-900">Copy or Download</p>
                  <p className="text-sm text-gray-500 mt-0.5 leading-relaxed">
                    Review files side-by-side inside the workspace interface, copy specific segments, or download the full cohesive project scaffold as a ZIP file.
                  </p>
                </div>
              </li>
            </ol>
          </div>
        </section>

        {/* CTA Section */}
        <section className="max-w-3xl mx-auto px-6 py-20 text-center">
          <h2 className="text-3xl font-bold text-gray-900 mb-4">
            Ready to generate your production stack?
          </h2>
          <p className="text-gray-500 mb-8 text-base">
            Free, takes under 30 seconds, and no account required.
          </p>
          <Link
            className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-8 py-3.5 rounded-xl text-base transition-colors no-underline"
            href="/generate"
          >
            Start generating free →
          </Link>
        </section>
      </main>

      <footer className="border-t border-gray-100">
        <div className="max-w-5xl mx-auto px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-gray-400">
          <span>© {new Date().getFullYear()} Enlight Lab</span>
          <span>Your data is handled in accordance with GDPR. We never sell leads.</span>
        </div>
      </footer>
    </div>
  );
}
