'use client';

import { CloudProvider, Orchestrator, CIProvider, ORCHESTRATOR_OPTIONS, CI_OPTIONS, CLOUD_OPTIONS } from '@/types';

interface PresetSelectorProps {
  presets: {
    cloud: CloudProvider;
    orchestrator: Orchestrator;
    ci: CIProvider;
  };
  onChange: (presets: { cloud: CloudProvider; orchestrator: Orchestrator; ci: CIProvider }) => void;
}

export function PresetSelector({ presets, onChange }: PresetSelectorProps) {
  const availableOrchestrators = ORCHESTRATOR_OPTIONS[presets.cloud] || [];

  const handleCloudChange = (cloud: CloudProvider) => {
    const orchestrators = ORCHESTRATOR_OPTIONS[cloud];
    const newOrchestrator = orchestrators?.[0]?.value as Orchestrator || 'oke';
    onChange({ cloud, orchestrator: newOrchestrator, ci: presets.ci });
  };

  const handleOrchestratorChange = (orchestrator: Orchestrator) => {
    onChange({ ...presets, orchestrator });
  };

  const handleCIChange = (ci: CIProvider) => {
    onChange({ ...presets, ci });
  };

  return (
    <div className="grid sm:grid-cols-3 gap-4">
      {/* Cloud Provider */}
      <div>
        <label className="section-label block mb-1">Cloud Provider</label>
        <select
          value={presets.cloud}
          onChange={(e) => handleCloudChange(e.target.value as CloudProvider)}
          className="input text-sm"
        >
          {CLOUD_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {/* Orchestrator */}
      <div>
        <label className="section-label block mb-1">Orchestrator</label>
        <select
          value={presets.orchestrator}
          onChange={(e) => handleOrchestratorChange(e.target.value as Orchestrator)}
          className="input text-sm"
          disabled={availableOrchestrators.length === 0}
        >
          {availableOrchestrators.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {/* CI Provider */}
      <div>
        <label className="section-label block mb-1">CI Provider</label>
        <select
          value={presets.ci}
          onChange={(e) => handleCIChange(e.target.value as CIProvider)}
          className="input text-sm"
        >
          {CI_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
