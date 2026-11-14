// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0: see LICENSE.md.
import { useState } from 'preact/hooks';
import type { RoleId } from '@/data/mission-constants';
import type { CrewView } from '@/ui/crew-view';
import { TeamPanel } from '@/ui/team-panel';
import { TEXT } from '@/ui/text';

export interface CrewScreenProps {
  crew: CrewView | null;
  /** False when this build has no online service configured: only the shared screen is offered. */
  onlineAvailable: boolean;
  busy: boolean;
  error: string | null;
  defaultName: string;
  /** Name of the mission the crew is already working on, if any. */
  missionName: string | null;
  onStartLocal: (names: string[]) => void;
  onCreateOnline: (name: string) => void;
  onJoinOnline: (code: string, name: string) => void;
  onAssign: (role: RoleId, playerId: string | null) => void;
  onRequest: (from: RoleId, to: RoleId, text: string) => void;
  onAnswer: (id: string, status: 'accepted' | 'declined') => void;
  onLeave: () => void;
  onContinue: () => void;
  onBack: () => void;
}

const SEATS = 4;

/** Gather a crew: around this screen, or each on their own device with a room code. */
export function CrewScreen(props: CrewScreenProps) {
  const t = TEXT.crew;
  const { crew } = props;
  const [names, setNames] = useState<string[]>(() => [props.defaultName, '', '', '']);
  const [name, setName] = useState(props.defaultName);
  const [code, setCode] = useState('');
  const seated = names.filter((entry) => entry.trim()).length;

  if (crew) {
    return (
      <section class="screen crew">
        <h1>{t.heading}</h1>
        {crew.kind === 'online' ? (
          <p class="room-code">
            {t.code} <strong>{crew.code}</strong>
            <span class="dim"> {t.codeHint}</span>
          </p>
        ) : (
          <p class="lede">{t.localLede}</p>
        )}
        <ul class="crew-list">
          {crew.players.map((player) => (
            <li key={player.id}>
              {player.name}
              {crew.kind === 'online' && player.here && <span class="dim"> {t.you}</span>}
            </li>
          ))}
        </ul>
        {props.error && <p class="banner">{props.error}</p>}
        <TeamPanel
          crew={crew}
          onAssign={props.onAssign}
          onRequest={props.onRequest}
          onAnswer={props.onAnswer}
        />
        <div class="actions">
          <button type="button" class="button" onClick={props.onLeave}>
            {t.leave}
          </button>
          <button type="button" class="button primary" data-autofocus onClick={props.onContinue}>
            {props.missionName ? `${t.joinMission} ${props.missionName}` : t.chooseMission}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section class="screen crew">
      <h1>{t.heading}</h1>
      <p class="lede">{t.lede}</p>
      {props.error && <p class="banner">{props.error}</p>}
      <div class="crew-options">
        <form
          class="card crew-option"
          onSubmit={(event) => {
            event.preventDefault();
            props.onStartLocal(names);
          }}
        >
          <h2>{t.local}</h2>
          <p class="card-text">{t.localSummary}</p>
          {Array.from({ length: SEATS }, (_, seat) => (
            <label key={seat}>
              {t.player} {seat + 1}
              <input
                type="text"
                value={names[seat]}
                maxLength={20}
                data-autofocus={seat === 0 ? true : undefined}
                onInput={(event) => {
                  const value = event.currentTarget.value;
                  setNames((current) => current.map((entry, index) => (index === seat ? value : entry)));
                }}
              />
            </label>
          ))}
          <button type="submit" class="button primary" disabled={seated < 2}>
            {t.startLocal}
          </button>
        </form>

        <div class="card crew-option">
          <h2>{t.online}</h2>
          <p class="card-text">{props.onlineAvailable ? t.onlineSummary : t.onlineUnavailable}</p>
          <label>
            {t.yourName}
            <input
              type="text"
              value={name}
              maxLength={20}
              disabled={!props.onlineAvailable}
              onInput={(event) => setName(event.currentTarget.value)}
            />
          </label>
          <button
            type="button"
            class="button primary"
            disabled={!props.onlineAvailable || props.busy || !name.trim()}
            onClick={() => props.onCreateOnline(name)}
          >
            {props.busy ? t.connecting : t.create}
          </button>
          <label>
            {t.code}
            <input
              type="text"
              value={code}
              maxLength={8}
              class="code-input"
              disabled={!props.onlineAvailable}
              onInput={(event) => setCode(event.currentTarget.value.toUpperCase())}
            />
          </label>
          <button
            type="button"
            class="button"
            disabled={!props.onlineAvailable || props.busy || !name.trim() || code.trim().length < 4}
            onClick={() => props.onJoinOnline(code, name)}
          >
            {t.join}
          </button>
        </div>
      </div>
      <div class="actions">
        <button type="button" class="button" onClick={props.onBack}>
          {TEXT.nav.back}
        </button>
      </div>
    </section>
  );
}
