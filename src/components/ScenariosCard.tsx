import React from 'react';
import { Settings2 } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import type { Scenario } from '@/types/financial';

interface ScenariosCardProps {
  scenarios: Scenario[];
  onScenariosChange: (scenarios: Scenario[]) => void;
}

export function ScenariosCard({ scenarios, onScenariosChange }: ScenariosCardProps) {
  const handleToggle = (scenarioId: string) => {
    onScenariosChange(
      scenarios.map((s) =>
        s.id === scenarioId ? { ...s, enabled: !s.enabled } : s
      )
    );
  };

  const enabledCount = scenarios.filter((s) => s.enabled).length;

  return (
    <div className="quadrant-card animate-fade-in h-full flex flex-col">
      <div className="quadrant-header">
        <div className="quadrant-title">
          <Settings2 className="h-5 w-5 text-primary" />
          IRRBB Scenarios
        </div>
        <span className="text-xs text-muted-foreground">
          {enabledCount} of {scenarios.length} selected
        </span>
      </div>

      <div className="quadrant-content flex-1">
        <p className="text-xs text-muted-foreground mb-4">
          Standard regulatory IRRBB scenarios
        </p>

        <div className="grid gap-2">
          {scenarios.map((scenario) => (
            <label
              key={scenario.id}
              className={`scenario-card ${scenario.enabled ? 'selected' : ''}`}
            >
              <Checkbox
                checked={scenario.enabled}
                onCheckedChange={() => handleToggle(scenario.id)}
                className="shrink-0"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground truncate">
                    {scenario.name}
                  </span>
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${
                      scenario.shockBps > 0
                        ? 'bg-destructive/10 text-destructive'
                        : 'bg-success/10 text-success'
                    }`}
                  >
                    {scenario.shockBps > 0 ? '+' : ''}
                    {scenario.shockBps} bps
                  </span>
                </div>
              </div>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}