// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0 or MIT: see LICENSE.md.
import { useState } from 'preact/hooks';
import { ROLE_IDS, type RoleId } from '@/data/mission-constants';
import { type CrewView, roleName, roleWithHolder } from '@/ui/crew-view';
import { TEXT } from '@/ui/text';

export interface TeamPanelProps {
  crew: CrewView;
  onAssign: (role: RoleId, playerId: string | null) => void;
  onRequest: (from: RoleId, to: RoleId, text: string) => void;
  onAnswer: (id: string, status: 'accepted' | 'declined') => void;
}

/** Who holds which role, and the requests the roles have sent each other. */
export function TeamPanel({ crew, onAssign, onRequest, onAnswer }: TeamPanelProps) {
  const t = TEXT.crew;
  const [from, setFrom] = useState<RoleId>(crew.mine[0] ?? 'director');
  const [to, setTo] = useState<RoleId>('engineer');
  const [text, setText] = useState('');
  const sender = crew.mine.includes(from) ? from : (crew.mine[0] ?? 'director');
  const open = crew.requests.filter((request) => request.status === 'open');

  return (
    <div class="team-panel">
      <section>
        <h3>{t.roles}</h3>
        <ul class="team-roles">
          {ROLE_IDS.map((role) => (
            <li key={role} data-role={role}>
              <label>
                <span class="role-chip">{roleName(role)}</span>
                <select
                  value={crew.holders[role] ?? ''}
                  onChange={(event) => onAssign(role, event.currentTarget.value || null)}
                >
                  <option value="">{t.anyone}</option>
                  {crew.players.map((player) => (
                    <option key={player.id} value={player.id}>
                      {player.name}
                      {crew.kind === 'online' && player.here ? ` ${t.you}` : ''}
                    </option>
                  ))}
                </select>
              </label>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3>
          {t.requests}
          {open.length > 0 && <span class="count"> {open.length}</span>}
        </h3>
        {crew.requests.length === 0 && <p class="hint">{t.noRequests}</p>}
        <ul class="team-requests">
          {crew.requests.map((request) => (
            <li key={request.id} data-status={request.status}>
              <span>
                <strong>
                  {roleWithHolder(crew, request.from)} → {roleWithHolder(crew, request.to)}:
                </strong>{' '}
                {request.text}
              </span>
              {request.status === 'open' && crew.mine.includes(request.to) ? (
                <span class="request-actions">
                  <button type="button" class="button small" onClick={() => onAnswer(request.id, 'accepted')}>
                    {t.accept}
                  </button>
                  <button type="button" class="button small" onClick={() => onAnswer(request.id, 'declined')}>
                    {t.decline}
                  </button>
                </span>
              ) : (
                <span class="request-status">{t.status[request.status]}</span>
              )}
            </li>
          ))}
        </ul>
        <form
          class="request-form"
          onSubmit={(event) => {
            event.preventDefault();
            onRequest(sender, to, text);
            setText('');
          }}
        >
          <label>
            {t.from}
            <select value={sender} onChange={(event) => setFrom(event.currentTarget.value as RoleId)}>
              {crew.mine.map((role) => (
                <option key={role} value={role}>
                  {roleName(role)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t.to}
            <select value={to} onChange={(event) => setTo(event.currentTarget.value as RoleId)}>
              {ROLE_IDS.map((role) => (
                <option key={role} value={role}>
                  {roleName(role)}
                </option>
              ))}
            </select>
          </label>
          <label class="grow">
            {t.ask}
            <input
              type="text"
              value={text}
              maxLength={140}
              placeholder={t.askPlaceholder}
              onInput={(event) => setText(event.currentTarget.value)}
            />
          </label>
          <button type="submit" class="button small" disabled={!text.trim()}>
            {t.send}
          </button>
        </form>
      </section>
    </div>
  );
}
