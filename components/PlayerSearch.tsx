"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { SearchResult } from "@/lib/types";
import { federationFlag } from "@/lib/federation-flag";

interface PlayerSearchProps {
  label: string;
  onSelect: (player: SearchResult | null) => void;
}

export default function PlayerSearch({ label, onSelect }: PlayerSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [selected, setSelected] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
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
    parts.push(p.name);
    return parts.join(" ");
  }

  return (
    <div ref={containerRef} className="relative w-full">
      <label className="block text-sm font-medium mb-1 text-[var(--text-secondary)]">
        {label}
      </label>
      <input
        type="text"
        value={query}
        onChange={(e) => handleInputChange(e.target.value)}
        onFocus={() => results.length > 0 && !selected && setIsOpen(true)}
        placeholder="Type a player name..."
        className="w-full px-4 py-3 border-2 border-[var(--board-dark)]/30 rounded-lg
                   focus:outline-none focus:border-[var(--board-dark)] bg-white
                   text-base transition-colors"
      />
      {loading && (
        <div className="absolute right-3 top-9 text-sm text-[var(--text-secondary)]">
          ...
        </div>
      )}
      {isOpen && results.length > 0 && (
        <ul className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
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
                <span>{r.name}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
