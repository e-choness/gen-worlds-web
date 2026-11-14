import type { ReadonlySignal } from '@preact/signals';
/**
 * The 2D shell: header with the mission stepper plus the current screen. It wires the store to the
 * screens (state down as props, navigation up as callbacks) and must not import the engine.
 */
import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { GameStore } from '@/app/game-store';
import { getTier, MISSION_CONSTANTS } from '@/data/mission-constants';
import { getScenario, SCENARIOS } from '@/data/scenarios';
import { createEmptyDesign, createReferenceDesign } from '@/mission/design';
import type { MissionPhase } from '@/mission/phases';
import { type CrewView, roleWithHolder } from '@/ui/crew-view';
import { Explainer } from '@/ui/explainer';
import { GlossaryDialog } from '@/ui/glossary-dialog';
import type { LeaderboardProps } from '@/ui/leaderboard';
import { PhaseStepper } from '@/ui/phase-stepper';
import { isMissionPhase } from '@/ui/screen-id';
import { ArrivalScreen } from '@/ui/screens/arrival-screen';
import { BriefingScreen } from '@/ui/screens/briefing-screen';
import { CrewScreen } from '@/ui/screens/crew-screen';
import { DebriefScreen } from '@/ui/screens/debrief-screen';
import { DesignScreen } from '@/ui/screens/design-screen';
import { FlightScreen } from '@/ui/screens/flight-screen';
import { PollScreen } from '@/ui/screens/poll-screen';
import { ScenarioScreen } from '@/ui/screens/scenario-screen';
import { TitleScreen } from '@/ui/screens/title-screen';
import { TrajectoryScreen } from '@/ui/screens/trajectory-screen';
import { TeamPanel } from '@/ui/team-panel';
import { TEXT } from '@/ui/text';

const NO_RESPONSES: Readonly<Record<string, number>> = {};

/** What the shell needs to offer sound without owning it: the app layer plays, the shell reports. */
export interface ShellSound {
  muted: ReadonlySignal<boolean>;
  onToggle: () => void;
  onCue: (cue: 'good' | 'bad' | 'neutral' | 'alert') => void;
}

interface ShellProps {
  store: GameStore;
  sound?: ShellSound;
}

/** The room as the screens see it, or null when playing alone. */
function crewView(store: GameStore): CrewView | null {
  const room = store.room.value;
  const kind = store.roomKind.value;
  if (!room || !kind) return null;
  const here = store.localPlayerIds.value;
  return {
    kind,
    code: room.code,
    players: Object.entries(room.players)
      .map(([id, player]) => ({ id, name: player.name, here: here.includes(id) }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    holders: room.roles,
    mine: store.myRoles.value,
    requests: Object.entries(room.requests ?? {})
      .map(([id, request]) => ({ id, ...request }))
      .sort((a, b) => b.at - a.at),
  };
}

/** The leaderboard of one scenario: the verified global board when online, this device's runs otherwise. */
function boardProps(store: GameStore, scenarioId: string, score: number): LeaderboardProps {
  const scores = store.scores.value;
  // Without a reachable board the debrief still ranks this device's own flights.
  const online = store.leaderboardAvailable && scores.status !== 'failed';
  const lines = online
    ? scores.entries.filter((entry) => entry.scenario === scenarioId)
    : store.history.value
        .filter((run) => run.design.scenarioId === scenarioId)
        .map((run) => ({ name: `${TEXT.debrief.run} ${run.id}`, score: run.score, daily: null }))
        .sort((a, b) => b.score - a.score);
  return {
    lines,
    scope: online ? 'global' : 'local',
    status: online ? scores.status : 'done',
    error: scores.status === 'failed' ? scores.error : null,
    score,
    defaultName: store.playerName.value,
    onSubmit: online && scores.status === 'done' ? (name) => store.submitScore(name) : null,
    submitted: store.scoreSubmitted.value,
    link: store.missionLink(),
  };
}

function Shell({ store, sound }: ShellProps) {
  const screen = store.screen.value;
  const webgpu = store.webgpu.value;
  const design = store.design.value;
  const evaluation = store.evaluation.value;
  const result = store.result.value;
  const main = useRef<HTMLElement>(null);
  const [glossaryOpen, setGlossaryOpen] = useState(false);
  const crew = crewView(store);
  // Events are only routed to roles when there is more than one person to route them to.
  const flightCrew = store.crewed.value ? crew : null;
  // The board is fetched when a debrief opens, not on every render.
  useEffect(() => {
    if (screen === 'debrief') store.loadScores();
  }, [screen, store]);
  const openRequests = crew?.requests.filter((request) => request.status === 'open').length ?? 0;

  // Keyboard and gamepad users land on the screen's main action after every screen change.
  useEffect(() => {
    if (!screen) return;
    main.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus({ preventScroll: true });
    main.current?.scrollTo(0, 0);
  }, [screen]);

  if (screen === 'sandbox' || screen === 'descent') {
    const error = store.engineError.value;
    // The engine's own HUD and menus take over once it runs; until then show progress or the error.
    if (webgpu !== 'unavailable' && !error) {
      return (
        <p class="shell-status">
          {screen === 'descent' ? TEXT.arrival.starting : TEXT.webgpu.sandboxStarting}
        </p>
      );
    }
    return (
      <div class="shell">
        <main ref={main}>
          <section class="screen">
            <h1>{screen === 'descent' ? TEXT.arrival.failed : TEXT.webgpu.sandboxFailed}</h1>
            <p class="lede">{error ?? TEXT.webgpu.unavailable}</p>
            <div class="actions">
              <button
                type="button"
                class="button primary"
                data-autofocus
                onClick={() => store.navigate(screen === 'descent' ? 'flight' : 'title')}
              >
                {screen === 'descent' ? TEXT.nav.back : TEXT.nav.home}
              </button>
            </div>
          </section>
        </main>
      </div>
    );
  }

  const phase = isMissionPhase(screen) ? screen : null;
  const scenario = design ? getScenario(design.scenarioId) : null;
  return (
    <div class="shell" data-screen={screen}>
      <header class="shell-header">
        <button type="button" class="brand" title={TEXT.nav.home} onClick={() => store.navigate('title')}>
          {TEXT.brand}
          <span>{TEXT.tagline}</span>
        </button>
        {screen !== 'title' && screen !== 'crew' && (
          <PhaseStepper current={phase} onSelect={(target: MissionPhase) => store.navigate(target)} />
        )}
        {sound && (
          <button
            type="button"
            class="button small sound-button"
            title={TEXT.sound.title}
            aria-label={sound.muted.value ? TEXT.sound.offLabel : TEXT.sound.onLabel}
            onClick={sound.onToggle}
          >
            {sound.muted.value ? TEXT.sound.off : TEXT.sound.on}
          </button>
        )}
        <button type="button" class="button small glossary-button" onClick={() => setGlossaryOpen(true)}>
          {TEXT.glossary.open}
        </button>
      </header>
      <GlossaryDialog open={glossaryOpen} onClose={() => setGlossaryOpen(false)} />
      {crew && screen !== 'crew' && screen !== 'title' && (
        <details class="team-drawer">
          <summary>
            {TEXT.crew.panel}
            {crew.kind === 'online' && <span class="room-code-chip">{crew.code}</span>}
            <span class="dim">{crew.players.map((player) => player.name).join(' · ')}</span>
            {openRequests > 0 && (
              <span class="count">
                {openRequests} {TEXT.crew.openRequests}
              </span>
            )}
          </summary>
          <TeamPanel
            crew={crew}
            onAssign={(role, playerId) => store.assignRole(role, playerId)}
            onRequest={(from, to, text) => store.sendRequest(from, to, text)}
            onAnswer={(id, status) => store.answerRequest(id, status)}
          />
        </details>
      )}
      <main ref={main}>
        {phase && design && <Explainer phase={phase} open={design.tier === 'cadet'} />}
        {screen === 'title' && (
          <TitleScreen
            sandboxAvailable={webgpu === 'available'}
            onNewMission={() => store.navigate('scenarios')}
            onCrew={() => store.navigate('crew')}
            onDaily={() => {
              store.startDaily();
              store.navigate('briefing');
            }}
            onSandbox={() => store.navigate('sandbox')}
          />
        )}
        {screen === 'crew' && (
          <CrewScreen
            crew={crew}
            onlineAvailable={store.onlineAvailable}
            busy={store.roomBusy.value}
            error={store.roomError.value}
            defaultName={store.playerName.value}
            missionName={crew && scenario ? scenario.name : null}
            onStartLocal={(names) => store.startLocalRoom(names)}
            onCreateOnline={(name) => void store.createOnlineRoom(name)}
            onJoinOnline={(code, name) => void store.joinOnlineRoom(code, name)}
            onAssign={(role, playerId) => store.assignRole(role, playerId)}
            onRequest={(from, to, text) => store.sendRequest(from, to, text)}
            onAnswer={(id, status) => store.answerRequest(id, status)}
            onLeave={() => store.leaveRoom()}
            onContinue={() => store.navigate(crew && scenario ? 'design' : 'scenarios')}
            onBack={() => store.navigate('title')}
          />
        )}
        {screen === 'scenarios' && (
          <ScenarioScreen
            scenarios={SCENARIOS}
            tiers={MISSION_CONSTANTS.tiers}
            tier={store.tier.value}
            onTier={(tier) => store.setTier(tier)}
            onChoose={(scenarioId) => {
              store.selectScenario(scenarioId);
              store.navigate('briefing');
            }}
            onBack={() => store.navigate('title')}
          />
        )}
        {phase === 'briefing' && scenario && design && (
          <BriefingScreen
            scenario={scenario}
            tier={getTier(design.tier)}
            onNext={() => store.navigate('design')}
            onBack={() => store.navigate('scenarios')}
          />
        )}
        {phase === 'design' && scenario && design && evaluation && (
          <DesignScreen
            evaluation={evaluation}
            crew={crew}
            canRender3d={webgpu === 'available'}
            onSetSlot={(slot, partId) => store.setSlot(slot, partId)}
            onToggleInstrument={(partId) => store.toggleInstrument(partId)}
            onToggleRedundant={(slot) => store.toggleRedundant(slot)}
            onLoadReference={() => store.loadDesign(createReferenceDesign(scenario, design.tier))}
            onClear={() => store.loadDesign(createEmptyDesign(scenario.id, design.tier))}
            onNext={() => store.navigate('trajectory')}
            onBack={() => store.navigate('briefing')}
          />
        )}
        {phase === 'trajectory' && evaluation && (
          <TrajectoryScreen
            evaluation={evaluation}
            crew={crew}
            onChange={(change) => store.setTrajectory(change)}
            onNext={() => store.navigate('poll')}
            onBack={() => store.navigate('design')}
          />
        )}
        {phase === 'poll' && evaluation && (
          <PollScreen
            evaluation={evaluation}
            votes={store.votes.value}
            forecast={store.forecast.value}
            crew={crew}
            challenge={store.challenge.value}
            onClearChallenge={() => store.clearChallenge()}
            onVote={(role, vote) => store.setVote(role, vote)}
            onAllGo={() => store.voteAllGo()}
            onForecast={() => store.requestForecast()}
            onLaunch={() => store.launch()}
            onBack={() => store.navigate('trajectory')}
          />
        )}
        {phase === 'flight' && !result && store.arrival.value && (
          <ArrivalScreen
            timeline={store.arrival.value.approach.timeline.filter(
              (entry) => entry.phase !== 'landing' && entry.phase !== 'surface',
            )}
            plan={store.arrival.value.plan}
            scenario={getScenario(store.arrival.value.approach.flownDesign.scenarioId)}
            canFlyByHand={webgpu === 'available'}
            waitingFor={store.holds('engineer') ? null : roleWithHolder(crew, 'engineer')}
            onFlyByHand={() => store.navigate('descent')}
            onAutomatic={() => store.landAutomatically()}
          />
        )}
        {phase === 'flight' && result && (
          <FlightScreen
            // A new flight restarts the playback.
            key={result.seed}
            result={result}
            notice={store.handFlown.value ? null : TEXT.flight.fastSimNote}
            crew={flightCrew}
            responses={store.room.value?.flight?.responses ?? NO_RESPONSES}
            onAcknowledge={(key, seconds) => store.acknowledge(key, seconds)}
            onDebrief={() => store.navigate('debrief')}
            onCue={sound?.onCue}
          />
        )}
        {phase === 'debrief' && result && scenario && (
          <DebriefScreen
            result={result}
            scenario={scenario}
            history={store.history.value}
            board={boardProps(store, scenario.id, result.score.total)}
            onRevise={(target) => store.navigate(target)}
            onFlyAgain={() => store.launch()}
            onNewMission={() => store.navigate('scenarios')}
          />
        )}
      </main>
    </div>
  );
}

export function mountShell(root: HTMLElement, store: GameStore, sound?: ShellSound): void {
  render(<Shell store={store} sound={sound} />, root);
}
