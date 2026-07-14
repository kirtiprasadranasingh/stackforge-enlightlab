import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';

export default function HomePage() {
  return (
    <div className="min-h-screen bg-white text-gray-900 font-sans bg-[linear-gradient(to_right,#80808006_1px,transparent_1px),linear-gradient(to_bottom,#80808006_1px,transparent_1px)] bg-[size:24px_24px] relative before:absolute before:inset-0 before:bg-[radial-gradient(circle_1000px_at_50%_150px,#eeeffc,transparent)] before:pointer-events-none">
      <SiteHeader ctaLabel="Generate stack →" />

      <main className="flex-1 relative z-10">
        {/* Hero Section */}
        <section className="max-w-5xl mx-auto px-6 pt-24 pb-16 text-center animate-fade-slide-up">
          <span className="inline-block text-[11px] font-bold tracking-widest text-indigo-600 uppercase mb-4">
            FREE · 30 SECONDS · NO ACCOUNT NEEDED
          </span>
          <h1 className="text-4xl sm:text-6xl font-bold tracking-tight text-gray-900 leading-tight mb-6">
            How cloud-ready is <span className="text-indigo-600">your application?</span>
          </h1>
          <p className="text-lg text-gray-500 max-w-2xl mx-auto mb-10 leading-relaxed">
            Describe your infrastructure in plain English and get an instant, copyable set of working configurations: Terraform files, CI/CD pipelines, and Kubernetes manifests.
          </p>
          <div className="flex justify-center mb-16">
            <Link
              className="inline-flex items-center gap-2 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white font-semibold px-8 py-4 rounded-full text-base transition-all shadow-md active:scale-95 no-underline hover:shadow-indigo-100"
              href="/generate"
            >
              Start your free generation
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3"></path>
              </svg>
            </Link>
          </div>

          {/* Score/Stats Badges */}
          <div className="max-w-4xl mx-auto grid grid-cols-2 sm:grid-cols-4 gap-4 mt-8">
            <div className="bg-white border border-gray-100 rounded-2xl py-5 px-4 shadow-sm hover:shadow-md transition-shadow">
              <p className="text-2xl font-extrabold text-gray-900">&lt; 30 sec</p>
              <p className="text-xs text-gray-400 font-semibold uppercase tracking-wider mt-1">To complete</p>
            </div>
            <div className="bg-white border border-gray-100 rounded-2xl py-5 px-4 shadow-sm hover:shadow-md transition-shadow">
              <p className="text-2xl font-extrabold text-gray-900">4 clouds</p>
              <p className="text-xs text-gray-400 font-semibold uppercase tracking-wider mt-1">Supported platforms</p>
            </div>
            <div className="bg-white border border-gray-100 rounded-2xl py-5 px-4 shadow-sm hover:shadow-md transition-shadow">
              <p className="text-2xl font-extrabold text-gray-900">3</p>
              <p className="text-xs text-gray-400 font-semibold uppercase tracking-wider mt-1">Core artifacts</p>
            </div>
            <div className="bg-white border border-gray-100 rounded-2xl py-5 px-4 shadow-sm hover:shadow-md transition-shadow">
              <p className="text-2xl font-extrabold text-gray-900">Free</p>
              <p className="text-xs text-gray-400 font-semibold uppercase tracking-wider mt-1">No sign-up needed</p>
            </div>
          </div>
        </section>

        {/* Four Dimensions Measured */}
        <section className="bg-gray-50/50 border-y border-gray-100 py-20">
          <div className="max-w-5xl mx-auto px-6">
            <p className="text-[11px] font-bold tracking-widest text-gray-400 uppercase text-center mb-10">
              FOUR DIMENSIONS MEASURED
            </p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
              <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm hover:shadow-md transition-shadow">
                <h3 className="font-bold text-gray-900 mb-2 text-base">Infrastructure (Terraform)</h3>
                <p className="text-sm text-gray-500 leading-relaxed">
                  VPC networking, compute clusters, secure environments, and pinned provider setups.
                </p>
              </div>
              <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm hover:shadow-md transition-shadow">
                <h3 className="font-bold text-gray-900 mb-2 text-base">CI / CD Pipelines</h3>
                <p className="text-sm text-gray-500 leading-relaxed">
                  Automated build, test, release, and secure registry deployment pipelines.
                </p>
              </div>
              <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm hover:shadow-md transition-shadow">
                <h3 className="font-bold text-gray-900 mb-2 text-base">Containers & K8s</h3>
                <p className="text-sm text-gray-500 leading-relaxed">
                  Multi-stage Dockerfiles and custom Helm charts complete with liveness/readiness probes.
                </p>
              </div>
              <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm hover:shadow-md transition-shadow">
                <h3 className="font-bold text-gray-900 mb-2 text-base">Production Defaults</h3>
                <p className="text-sm text-gray-500 leading-relaxed">
                  Autoscaling policies, ingress control, and least-privilege security setups.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Tiers Section */}
        <section className="max-w-5xl mx-auto px-6 py-20 text-center">
          <p className="text-[11px] font-bold tracking-widest text-gray-400 uppercase mb-3">
            CONFIGURATION SCOPE
          </p>
          <h2 className="text-3xl font-bold text-gray-900 mb-12">
            Which configuration scope will you generate?
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
              <span className="inline-block text-[10px] font-extrabold px-3 py-1 rounded-full mb-3 bg-red-50 text-red-600 border border-red-100">
                Single VM
              </span>
              <p className="text-sm font-bold text-gray-800">Basic VPS</p>
              <p className="text-xs text-gray-400 mt-1">0-20 scope</p>
            </div>
            <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
              <span className="inline-block text-[10px] font-extrabold px-3 py-1 rounded-full mb-3 bg-orange-50 text-orange-600 border border-orange-100">
                Exploring
              </span>
              <p className="text-sm font-bold text-gray-800">Network & IP</p>
              <p className="text-xs text-gray-400 mt-1">21-40 scope</p>
            </div>
            <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
              <span className="inline-block text-[10px] font-extrabold px-3 py-1 rounded-full mb-3 bg-yellow-50 text-yellow-600 border border-yellow-100">
                Dockerized
              </span>
              <p className="text-sm font-bold text-gray-800">Container Scaf</p>
              <p className="text-xs text-gray-400 mt-1">41-60 scope</p>
            </div>
            <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
              <span className="inline-block text-[10px] font-extrabold px-3 py-1 rounded-full mb-3 bg-blue-50 text-blue-600 border border-blue-100">
                Scaling K8s
              </span>
              <p className="text-sm font-bold text-gray-800">Orchestrated</p>
              <p className="text-xs text-gray-400 mt-1">61-80 scope</p>
            </div>
            <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm col-span-2 md:col-span-1">
              <span className="inline-block text-[10px] font-extrabold px-3 py-1 rounded-full mb-3 bg-green-50 text-green-600 border border-green-100">
                Production-Grade
              </span>
              <p className="text-sm font-bold text-gray-800">High Avail</p>
              <p className="text-xs text-gray-400 mt-1">81-100 scope</p>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="bg-gray-50/50 border-y border-gray-100 py-20">
          <div className="max-w-3xl mx-auto px-6">
            <p className="text-[11px] font-bold tracking-widest text-gray-400 uppercase text-center mb-12">
              HOW IT WORKS
            </p>
            <div className="space-y-8">
              <div className="flex gap-6 items-start">
                <span className="flex-shrink-0 w-8 h-8 rounded-full bg-indigo-600 text-white text-sm font-bold flex items-center justify-center shadow-sm">
                  1
                </span>
                <div>
                  <h4 className="font-bold text-gray-900 text-base">Select your cloud presets</h4>
                  <p className="text-sm text-gray-500 mt-1 leading-relaxed">
                    Choose your target cloud platform, container orchestrator, and CI pipeline provider to establish the environment parameters.
                  </p>
                </div>
              </div>
              <div className="flex gap-6 items-start">
                <span className="flex-shrink-0 w-8 h-8 rounded-full bg-indigo-600 text-white text-sm font-bold flex items-center justify-center shadow-sm">
                  2
                </span>
                <div>
                  <h4 className="font-bold text-gray-900 text-base">Describe your application needs</h4>
                  <p className="text-sm text-gray-500 mt-1 leading-relaxed">
                    Specify database setups, autoscaling thresholds, load balancer configurations, and environment secrets in plain prose.
                  </p>
                </div>
              </div>
              <div className="flex gap-6 items-start">
                <span className="flex-shrink-0 w-8 h-8 rounded-full bg-indigo-600 text-white text-sm font-bold flex items-center justify-center shadow-sm">
                  3
                </span>
                <div>
                  <h4 className="font-bold text-gray-900 text-base">Watch the configurations stream</h4>
                  <p className="text-sm text-gray-500 mt-1 leading-relaxed">
                    Watch as StackForge streams back networking modules, CI configuration files, container manifests, and deployment templates.
                  </p>
                </div>
              </div>
              <div className="flex gap-6 items-start">
                <span className="flex-shrink-0 w-8 h-8 rounded-full bg-indigo-600 text-white text-sm font-bold flex items-center justify-center shadow-sm">
                  4
                </span>
                <div>
                  <h4 className="font-bold text-gray-900 text-base">Copy or download ZIP files</h4>
                  <p className="text-sm text-gray-500 mt-1 leading-relaxed">
                    Review files side-by-side inside the workspace interface, copy specific segments, or download the full cohesive project scaffold as a ZIP file.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="max-w-4xl mx-auto px-6 py-24 text-center animate-fade-slide-up">
          <h2 className="text-4xl font-bold tracking-tight text-gray-900 mb-4">
            Ready to find out where you stand?
          </h2>
          <p className="text-gray-400 mb-8 font-medium">
            Free, takes under 30 seconds, and no account required.
          </p>
          <Link
            className="inline-flex items-center gap-2 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white font-semibold px-8 py-4 rounded-full text-base transition-all shadow-md active:scale-95 no-underline hover:shadow-indigo-100"
            href="/generate"
          >
            Start your free generation
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3"></path>
            </svg>
          </Link>
        </section>
      </main>

      <footer className="border-t border-gray-100 bg-white/50 relative z-10">
        <div className="max-w-5xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-gray-400">
          <span>© {new Date().getFullYear()} Enlight Lab</span>
          <span>Your data is handled in accordance with GDPR. We never sell leads.</span>
        </div>
      </footer>
    </div>
  );
}
