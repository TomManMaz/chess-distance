"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { SearchResult } from "@/lib/types";
import { federationFlag } from "@/lib/federation-flag";
import { toDisplayName } from "@/lib/names";

interface PlayerSearchProps {
  placeholder?: string;
  onSelect: (player: SearchResult | null) => void;
  externalPlayer?: SearchResult | null; // set from outside to pre-fill
}

export default function PlayerSearch({ placeholder = "Name or FIDE ID...", onSelect, externalPlayer }: PlayerSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [selected, setSelected] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);

  // Sync when a player is set externally (e.g. from an example button)
  useEffect(() => {
    if (externalPlayer === undefined) return;
    if (externalPlayer) {
      setSelected(externalPlayer);
      setQuery(formatPlayer(externalPlayer));
      setIsOpen(false);
    } else {
      setSelected(null);
      setQuery("");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalPlayer]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const search = useCallback(async (q: string) => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      const data: SearchResult[] = await res.json();
      setResults(data);
      setIsOpen(data.length > 0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selected) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(query), 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, selected, search]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function handleSelect(player: SearchResult) {
    setSelected(player);
    setQuery(formatPlayer(player));
    setIsOpen(false);
    onSelect(player);
  }

  function handleInputChange(value: string) {
    setQuery(value);
    if (selected) {
      setSelected(null);
      onSelect(null);
    }
  }

  function formatPlayer(p: SearchResult): string {
    const parts: string[] = [];
    const flag = p.federation ? federationFlag(p.federation) : "";
    if (flag) parts.push(flag);
    if (p.title) parts.push(p.title);
    parts.push(toDisplayName(p.name));
    return parts.join(" ");
  }

  return (
    <div ref={containerRef} className="relative w-full">
      <input
        type="text"
        value={query}
        onChange={(e) => handleInputChange(e.target.value)}
        onFocus={() => results.length > 0 && !selected && setIsOpen(true)}
        placeholder={placeholder}
        className="w-full px-4 py-3 border-2 border-[var(--board-dark)]/30 rounded-lg
                   focus:outline-none focus:border-[var(--board-dark)] bg-[var(--bg-card)] text-[var(--text-primary)]
                   text-base transition-colors"
      />
      {loading && (
        <div className="absolute right-3 top-9 text-sm text-[var(--text-secondary)]">
          ...
        </div>
      )}
      {isOpen && results.length > 0 && (
        <ul className="absolute z-10 w-full mt-1 bg-[var(--bg-card)] border border-[var(--board-light)] rounded-lg shadow-lg max-h-60 overflow-y-auto">
          {results.map((r) => (
            <li
              key={r.id}
              onClick={() => handleSelect(r)}
              className="px-4 py-2 cursor-pointer hover:bg-[var(--board-light)] transition-colors flex items-center gap-2"
            >
              {r.federation && (
                <span className="text-lg leading-none" title={r.federation}>
                  {federationFlag(r.federation) || r.federation}
                </span>
              )}
              <span>
                <span className="font-semibold text-[var(--board-dark)]">
                  {r.title && `${r.title} `}
                </span>
                <span>{toDisplayName(r.name)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
