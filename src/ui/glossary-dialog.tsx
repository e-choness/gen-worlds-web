// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0 or MIT: see LICENSE.md.
import { useEffect, useRef, useState } from 'preact/hooks';
import { GLOSSARY } from '@/data/glossary';
import { TEXT } from '@/ui/text';

export interface GlossaryDialogProps {
  open: boolean;
  onClose: () => void;
}

/** Every term the game uses, in plain language, one search away from any screen. */
export function GlossaryDialog({ open, onClose }: GlossaryDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [filter, setFilter] = useState('');
  const t = TEXT.glossary;

  // The native dialog gives focus trapping and Escape for free.
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  const needle = filter.trim().toLowerCase();
  const terms = GLOSSARY.filter(
    (entry) =>
      !needle || entry.term.toLowerCase().includes(needle) || entry.definition.toLowerCase().includes(needle),
  );

  return (
    <dialog ref={dialog} class="glossary" aria-label={t.heading} onClose={onClose}>
      <header>
        <h2>{t.heading}</h2>
        <button type="button" class="button small" onClick={onClose}>
          {t.close}
        </button>
      </header>
      <input
        type="search"
        value={filter}
        placeholder={t.search}
        aria-label={t.search}
        onInput={(event) => setFilter(event.currentTarget.value)}
      />
      <dl>
        {terms.map((entry) => (
          <div key={entry.id}>
            <dt>{entry.term}</dt>
            <dd>
              {entry.definition} <span class="dim">{entry.whereUsed}.</span>
            </dd>
          </div>
        ))}
      </dl>
      {terms.length === 0 && <p class="dim">{t.none}</p>}
    </dialog>
  );
}
