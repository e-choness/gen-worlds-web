import { App, parseStartOptions } from '@/app/app';
import { UnsupportedError } from '@/engine/engine';
import { DebugHud } from '@/ui/debug-hud';
import { Hud } from '@/ui/hud';
import { Menu } from '@/ui/menu';

declare global {
  interface Window {
    /** Exposed for automated captures and console debugging only. */
    __app?: App;
    __menu?: Menu;
    /** Set when the first frames have been presented or start-up failed. */
    __status?: 'booting' | 'running' | 'failed';
  }
}

async function main(): Promise<void> {
  window.__status = 'booting';
  const canvas = document.getElementById('viewport') as HTMLCanvasElement;
  const uiRoot = document.getElementById('ui-root') as HTMLElement;
  try {
    const params = new URLSearchParams(location.search);
    const app = await App.create({ canvas, start: parseStartOptions(location.search) });
    window.__app = app;
    const hud = new Hud(uiRoot, app.scanner);
    const menu = new Menu(
      uiRoot,
      app.settings,
      app.scanner,
      {
        system: () => app.system,
        cameraPosition: () => app.cameraPosition,
        beacons: () => app.beacons,
      },
      {
        opened: () => {
          app.setControlsEnabled(false);
          app.input.unlock();
        },
        resume: () => {
          app.setControlsEnabled(true);
          app.audio.unlock();
          // May be refused right after Esc released the pointer; the HUD then asks for a click.
          app.input.lock();
        },
        navigateTo: (body) => app.navigateTo(body),
      },
    );
    window.__menu = menu;
    app.events.on('notice', (message) => hud.toast(message));

    // Captures pass ?nostart to go straight into play without the title screen.
    const skipStart = params.has('nostart');
    if (params.has('menu')) menu.open((params.get('menu') || 'title') as Parameters<Menu['open']>[0]);
    else if (!skipStart) menu.open('title');

    // The browser releases the pointer on Esc without delivering the key: treat that as "pause".
    document.addEventListener('pointerlockchange', () => {
      if (!app.input.locked && !menu.isOpen) menu.open('pause');
    });

    app.onFrame((dt) => {
      const input = app.input;
      if (!menu.isOpen || menu.screen === 'map') {
        if (input.justPressed('Tab')) menu.toggle('map');
      }
      if (!menu.isOpen) {
        if (input.justPressed('KeyH') || input.justPressed('F1')) menu.open('controls');
        if (input.justPressed('KeyJ')) menu.open('logbook');
      }
      const site = app.scanner.target?.kind === 'site' ? app.scanner.target.site : null;
      hud.update(dt, {
        system: app.system,
        telemetry: app.flight.telemetry,
        camera: app.engine.camera,
        cameraPosition: app.cameraPosition,
        galacticPosition: app.galacticPosition,
        autopilotTarget: app.flight.autopilot?.name ?? null,
        landing: app.flight.isLanding,
        beacons: app.beacons,
        region: site ? site.terrainType : null,
        hidden: menu.isOpen,
        promptClick: !menu.isOpen && !input.locked && !skipStart,
      });
    });
    if (params.has('debug')) new DebugHud(uiRoot, app);
    window.__status = 'running';
  } catch (error) {
    window.__status = 'failed';
    console.error(error);
    const message =
      error instanceof UnsupportedError
        ? `${error.message} Use a current Chrome or Edge with hardware acceleration enabled.`
        : `Start-up failed: ${error instanceof Error ? error.message : String(error)}`;
    const panel = document.createElement('div');
    panel.className = 'fatal';
    panel.textContent = message;
    uiRoot.append(panel);
  }
}

void main();
