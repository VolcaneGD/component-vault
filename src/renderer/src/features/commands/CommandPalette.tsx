import { useEffect, useId, useMemo, useRef, useState } from 'react';

export interface CommandDefinition {
  id: string;
  label: string;
  group: string;
  keywords?: string[];
  shortcut?: string;
  disabled?: boolean;
  run: () => Promise<unknown> | unknown;
}

interface CommandPaletteProps {
  commands: CommandDefinition[];
  onClose: () => void;
  returnFocus?: HTMLElement | null;
}

const normalize = (value: string): string => value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const isSubsequence = (needle: string, haystack: string): boolean => {
  let index = 0;
  for (const character of haystack) {
    if (character === needle[index]) index += 1;
    if (index === needle.length) return true;
  }
  return needle.length === 0;
};

export const fuzzyCommandMatch = (command: CommandDefinition, query: string): boolean => {
  const tokens = normalize(query).split(' ').filter(Boolean);
  if (tokens.length === 0) return true;
  const haystack = normalize([command.label, command.group, ...(command.keywords ?? [])].join(' '));
  return tokens.every((token) => isSubsequence(token, haystack));
};

export const CommandPalette = ({ commands, onClose, returnFocus }: CommandPaletteProps) => {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const listboxId = useId();
  const results = useMemo(
    () => commands.filter((command) => fuzzyCommandMatch(command, query)),
    [commands, query],
  );

  useEffect(() => {
    inputRef.current?.focus();
    return () => returnFocus?.focus();
  }, [returnFocus]);

  useEffect(() => setActiveIndex(0), [query]);

  const close = () => onClose();
  const run = async (command: CommandDefinition | undefined) => {
    if (!command || command.disabled) return;
    setError('');
    try {
      await command.run();
      close();
    } catch {
      setError(`Could not run ${command.label}. Your work is still available.`);
    }
  };

  return (
    <div className="command-palette-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) close();
    }}>
      <section
        ref={dialogRef}
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            close();
          } else if (event.key === 'Tab') {
            const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
              'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], summary, [tabindex]:not([tabindex="-1"])',
            ) ?? []).filter((element) => !element.hidden);
            if (focusable.length === 0) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (first === last || (event.shiftKey && document.activeElement === first)) {
              event.preventDefault();
              last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first.focus();
            }
          } else if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActiveIndex((index) => results.length ? (index + 1) % results.length : 0);
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActiveIndex((index) => results.length ? (index - 1 + results.length) % results.length : 0);
          } else if (event.key === 'Enter') {
            event.preventDefault();
            void run(results[activeIndex]);
          }
        }}
      >
        <label className="command-palette__search">
          <span className="sr-only">Search commands</span>
          <input
            ref={inputRef}
            role="combobox"
            aria-label="Search commands"
            aria-autocomplete="list"
            aria-expanded="true"
            aria-controls={listboxId}
            aria-activedescendant={results[activeIndex] ? `${listboxId}-${results[activeIndex].id}` : undefined}
            value={query}
            placeholder="Type a command..."
            onChange={(event) => {
              setError('');
              setQuery(event.target.value);
            }}
          />
          <kbd>Esc</kbd>
        </label>
        <ul id={listboxId} role="listbox" aria-label="Available commands">
          {results.map((command, index) => (
            <li
              key={command.id}
              id={`${listboxId}-${command.id}`}
              role="option"
              aria-selected={index === activeIndex}
              aria-disabled={command.disabled || undefined}
              onMouseMove={() => setActiveIndex(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => void run(command)}
            >
              <span><small>{command.group}</small>{command.label}</span>
              {command.shortcut && <kbd>{command.shortcut}</kbd>}
            </li>
          ))}
          {results.length === 0 && <li className="command-palette__empty">No matching commands</li>}
        </ul>
        {error && <p className="command-palette__error" role="alert">{error}</p>}
      </section>
    </div>
  );
};
