import { useMemo, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Check, Loader2, Search, Wand2, X } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { getAvailableSkillNames, recommendSkillsForAgent } from '../../../lib/skillRecommendations';
import type { AgentDefinition, SkillInfo } from '../../../types';

interface PreferredSkillsPickerProps {
  agent: AgentDefinition;
  skills: SkillInfo[];
  value?: string[];
  onChange: (value: string[]) => void;
  onSuggestAll?: () => void;
  suggestingAll?: boolean;
}

function unique(values: string[]) {
  return Array.from(new Set(values.map(value => value.trim()).filter(Boolean)));
}

export function PreferredSkillsPicker({
  agent,
  skills,
  value = [],
  onChange,
  onSuggestAll,
  suggestingAll = false,
}: PreferredSkillsPickerProps) {
  const [query, setQuery] = useState('');
  const selected = useMemo(() => unique(value), [value]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const availableSkillNames = useMemo(() => getAvailableSkillNames(skills), [skills]);
  const availableSet = useMemo(() => new Set(availableSkillNames), [availableSkillNames]);
  const suggested = useMemo(() => recommendSkillsForAgent(agent, skills), [agent, skills]);
  const normalizedQuery = query.trim().toLowerCase();
  const selectableSkillNames = useMemo(() => (
    availableSkillNames
      .filter(name => !selectedSet.has(name))
      .filter(name => !normalizedQuery || name.toLowerCase().includes(normalizedQuery))
  ), [availableSkillNames, normalizedQuery, selectedSet]);

  const addSkill = (skillName: string) => {
    const name = skillName.trim();
    if (!name) return;
    onChange(unique([...selected, name]));
    setQuery('');
  };

  const removeSkill = (skillName: string) => {
    onChange(selected.filter(name => name !== skillName));
  };

  const useSuggested = () => {
    if (suggested.length === 0) return;
    onChange(suggested);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (selectableSkillNames[0]) {
      addSkill(selectableSkillNames[0]);
      return;
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs font-medium text-muted-foreground">Preferred skills</label>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={useSuggested}
            disabled={suggested.length === 0}
            title="Use suggested skills for this template"
            className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
          >
            <Wand2 size={12} />
            Suggest
          </button>
          {onSuggestAll && (
            <button
              type="button"
              onClick={onSuggestAll}
              disabled={suggestingAll || availableSkillNames.length === 0}
              title="Apply suggested skills to every template"
              className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
            >
              {suggestingAll ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}
              All
            </button>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-border/60 bg-muted/20 p-2 focus-within:ring-2 focus-within:ring-primary/30">
        <div className="flex min-h-8 flex-wrap gap-1.5">
          {selected.map(skillName => (
            <span
              key={skillName}
              className={cn(
                'inline-flex max-w-full items-center gap-1 rounded-md border px-2 py-1 text-xs',
                availableSet.has(skillName)
                  ? 'border-primary/25 bg-primary/10 text-primary'
                  : 'border-border bg-muted text-muted-foreground',
              )}
              title={availableSet.has(skillName) ? skillName : `${skillName} is not currently installed`}
            >
              {availableSet.has(skillName) && <Check size={11} />}
              <span className="truncate">{skillName}</span>
              <button
                type="button"
                onClick={() => removeSkill(skillName)}
                className="rounded-sm text-current opacity-70 transition-opacity hover:opacity-100"
                title={`Remove ${skillName}`}
              >
                <X size={11} />
              </button>
            </span>
          ))}
          {selected.length === 0 && (
            <span className="px-1 py-1 text-xs text-muted-foreground/60">No preferred skills</span>
          )}
        </div>

        <div className="relative mt-2">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/45" />
          <input
            value={query}
            onChange={event => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search installed skills"
            className="w-full rounded-md border border-border/50 bg-background/60 py-1.5 pl-8 pr-2 text-xs focus:outline-none"
          />
        </div>

        <select
          value=""
          onChange={event => addSkill(event.target.value)}
          disabled={selectableSkillNames.length === 0}
          className="mt-2 w-full rounded-md border border-border/50 bg-background/60 px-2 py-1.5 text-xs text-muted-foreground focus:outline-none disabled:opacity-45"
          title="Add an installed skill"
        >
          <option value="">
            {selectableSkillNames.length === 0 ? 'No matching skills' : `Add skill (${selectableSkillNames.length})`}
          </option>
          {selectableSkillNames.map(skillName => (
            <option key={skillName} value={skillName}>{skillName}</option>
          ))}
        </select>

        {suggested.length > 0 && (
          <div className="mt-2 space-y-2">
            <div className="flex flex-wrap gap-1">
              {suggested.map(skillName => (
                <button
                  key={skillName}
                  type="button"
                  onClick={() => addSkill(skillName)}
                  disabled={selectedSet.has(skillName)}
                  className="rounded-md border border-primary/25 bg-primary/10 px-2 py-1 text-xs text-primary transition-colors hover:bg-primary/15 disabled:opacity-45"
                  title={skillName}
                >
                  {skillName}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
