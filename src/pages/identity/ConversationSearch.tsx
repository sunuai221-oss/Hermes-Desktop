import { useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import { Card } from '../../components/Card';
import * as api from '../../api';
import { parsePlatformFromKey } from '../../lib/utils';
import type { MemorySearchResult } from '../../types';

export function ConversationSearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MemorySearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  const search = async () => {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const res = await api.memory.search(query.trim());
      setResults(Array.isArray(res.data) ? res.data : []);
    } finally {
      setSearching(false);
    }
  };

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-border/40 px-5 py-3">
        <div className="flex items-center gap-2">
          <Search size={14} className="text-primary" />
          <span className="text-sm font-medium">Conversation history</span>
        </div>
      </div>
      <div className="space-y-4 p-5">
        <div className="flex gap-2">
          <input
            value={query}
            onChange={event => setQuery(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') void search();
            }}
            placeholder="Search past conversations"
            className="flex-1 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          <button
            onClick={() => void search()}
            disabled={searching || !query.trim()}
            className="rounded-lg bg-primary/10 px-4 py-2 text-sm font-medium text-primary hover:bg-primary/15 disabled:opacity-40"
          >
            {searching ? <Loader2 size={14} className="animate-spin" /> : 'Search'}
          </button>
        </div>
        <div className="max-h-[320px] space-y-2 overflow-auto">
          {results.length === 0 && query && !searching ? (
            <p className="py-6 text-center text-sm text-muted-foreground/40">No results.</p>
          ) : results.map((result, index) => (
            <div key={`${result.sessionId}-${index}`} className="rounded-lg bg-muted/30 p-3">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-medium text-foreground">{parsePlatformFromKey(result.sessionId) || result.platform}</span>
                <span className="text-[10px] text-muted-foreground/50">{result.role}</span>
              </div>
              <p className="line-clamp-3 whitespace-pre-wrap text-xs text-muted-foreground">{result.snippet}</p>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}
