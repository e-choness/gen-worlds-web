/**
 * The 2D shell: header with the mission stepper plus the current screen. It wires the store to the
 * screens (state down as props, navigation up as callbacks) and must not import the engine.
 */
import { render } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import type { GameStore } from '@/app/game-store';
import { getTier, MISSION_CONSTANTS } from '@/data/mission-constants';
import { getScenario, SCENARIOS } from '@/data/scenarios';
import { createEmptyDesign, createReferenceDesign } from '@/mission/design';
import type { MissionPhase } from '@/mission/phases';
import { PhaseStepper } from '@/ui/phase-stepper';
import { isMissionPhase } from '@/ui/screen-id';
import { BriefingScreen } from '@/ui/screens/briefing-screen';
import { DebriefScreen } from '@/ui/screens/debrief-screen';
import { DesignScreen } from '@/ui/screens/design-screen';
import { FlightScreen } from '@/ui/screens/flight-screen';
import { PollScreen } from '@/ui/screens/poll-screen';
import { ScenarioScreen } from '@/ui/screens/scenario-screen';
import { TitleScreen } from '@/ui/screens/title-screen';
import { TrajectoryScreen } from '@/ui/screens/trajectory-screen';
import { TEXT } from '@/ui/text';

interface ShellProps {
  store: GameStore;
}

function Shell({ store }: ShellProps) {
  const screen = store.screen.value;
  const webgpu = store.webgpu.value;
  const design = store.design.value;
  const evaluation = store.evaluation.value;
  const result = store.result.value;
  const main = useRef<HTMLElement>(null);

  // Keyboard and gamepad users land on the screen's main action after every screen change.
  useEffect(() => {
    if (!screen) return;
    main.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus({ preventScroll: true });
    main.current?.scrollTo(0, 0);
  }, [screen]);

  if (screen === 'sandbox') {
    const error = store.engineError.value;
    // The engine's own HUD and menus take over once it runs; until then show progress or the error.
    if (webgpu !== 'unavailable' && !error) return <p class="shell-status">{TEXT.webgpu.sandboxStarting}</p>;
    return (
      <div class="shell">
        <main ref={main}>
          <section class="screen">
            <h1>{TEXT.webgpu.sandboxFailed}</h1>
            <p class="lede">{error ?? TEXT.webgpu.unavailable}</p>
            <div class="actions">
              <button
                type="button"
                class="button primary"
                data-autofocus
                onClick={() => store.navigate('title')}
              >
                {TEXT.nav.home}
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
        {screen !== 'title' && (
          <PhaseStepper current={phase} onSelect={(target: MissionPhase) => store.navigate(target)} />
        )}
      </header>
      <main ref={main}>
        {screen === 'title' && (
          <TitleScreen
            sandboxAvailable={webgpu === 'available'}
            onNewMission={() => store.navigate('scenarios')}
            onSandbox={() => store.navigate('sandbox')}
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
            onVote={(role, vote) => store.setVote(role, vote)}
            onAllGo={() => store.voteAllGo()}
            onForecast={() => store.requestForecast()}
            onLaunch={() => store.launch()}
            onBack={() => store.navigate('trajectory')}
          />
        )}
        {phase === 'flight' && result && (
          <FlightScreen
            // A new flight restarts the playback.
            key={result.seed}
            result={result}
            notice={TEXT.flight.fastSimNote}
            onDebrief={() => store.navigate('debrief')}
          />
        )}
        {phase === 'debrief' && result && scenario && (
          <DebriefScreen
            result={result}
            scenario={scenario}
            history={store.history.value}
            onRevise={(target) => store.navigate(target)}
            onFlyAgain={() => store.launch()}
            onNewMission={() => store.navigate('scenarios')}
          />
        )}
      </main>
    </div>
  );
}

export function mountShell(root: HTMLElement, store: GameStore): void {
  render(<Shell store={store} />, root);
}
