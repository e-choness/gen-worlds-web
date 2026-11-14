// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0: see LICENSE.md.
/**
 * The 3D sandbox: the free-flight galaxy with its own HUD and menus. This module pulls in the whole
 * engine, so it is only ever reached through a dynamic import after WebGPU has been confirmed.
 */

import { h, render } from 'preact';
import { App, parseStartOptions } from '@/app/app';
import { SCENARIOS } from '@/data/scenarios';
import { decodeWorld, encodeWorld } from '@/data/world';
import { saveWorldShot } from '@/ui/art';
import { DebugHud } from '@/ui/debug-hud';
import { Hud } from '@/ui/hud';
import { Menu } from '@/ui/menu';
import { MapScreen } from '@/ui/screens/map-screen';
import { TEXT } from '@/ui/text';
import { isLandable, worldParamsOf } from '@/universe/world-params';

declare global {
  interface Window {
    /** Exposed for automated captures and console debugging only. */
    __app?: App;
    __menu?: Menu;
  }
}

/** Starts the sandbox on `canvas`; `search` carries the start-up overrides (see `parseStartOptions`). */
export async function startSandbox(
  canvas: HTMLCanvasElement,
  uiRoot: HTMLElement,
  search: string,
): Promise<App> {
  const params = new URLSearchParams(search);
  const app = await App.create({ canvas, start: parseStartOptions(search) });
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
      // The engine has no warm shutdown: the main menu is a fresh page.
      exit: () => {
        location.href = location.pathname;
      },
    },
  );
  window.__menu = menu;
  app.events.on('notice', (message) => hud.toast(message));

  // Captures pass ?nostart to go straight into play without the sandbox's own title panel.
  const skipStart = params.has('nostart');
  if (params.has('menu')) menu.open((params.get('menu') || 'title') as Parameters<Menu['open']>[0]);
  else if (!skipStart) menu.open('title');

  // The browser releases the pointer on Esc without delivering the key: treat that as "pause".
  document.addEventListener('pointerlockchange', () => {
    if (!app.input.locked && !menu.isOpen && !mapOpen) menu.open('pause');
  });

  // The galaxy map, the same one the mission screens use, laid over the view. From here it starts
  // at the star the craft is at, and travelling happens in place.
  const mapRoot = document.createElement('div');
  mapRoot.className = 'map-overlay';
  mapRoot.hidden = true;
  uiRoot.append(mapRoot);
  let mapOpen = false;
  const closeMap = (): void => {
    if (!mapOpen) return;
    mapOpen = false;
    render(null, mapRoot);
    mapRoot.hidden = true;
    app.setControlsEnabled(true);
    app.input.lock();
  };
  const openMap = (): void => {
    mapOpen = true;
    mapRoot.hidden = false;
    app.setControlsEnabled(false);
    app.input.unlock();
    render(
      h(MapScreen, {
        catalogMissions: Object.fromEntries(SCENARIOS.map((entry) => [entry.targetBody, entry.id])),
        initial: { star: app.system.system.star, real: app.system.system.real === true },
        flyLabel: TEXT.map.travel,
        // The mission screens open on a fresh page: the 3D engine has no warm shutdown.
        onPlan: (scenarioId: string) => {
          location.href = `${location.pathname}?world=${encodeURIComponent(scenarioId)}`;
        },
        onFly: (worldId: string) => {
          app.goToWorld(decodeWorld(worldId));
          closeMap();
        },
        onBack: closeMap,
      }),
      mapRoot,
    );
  };
  window.addEventListener('keydown', (event) => {
    if (!mapOpen || (event.code !== 'Tab' && event.code !== 'Escape')) return;
    event.preventDefault();
    closeMap();
  });

  // The link between the galaxy and the missions: any solid world can be the next destination.
  let planning = false;
  const planMissionHere = (): void => {
    const body = app.flight.telemetry.body;
    if (planning || !body) return;
    if (app.system.system.real) {
      hud.toast(TEXT.sandbox.planRealBody);
      return;
    }
    if (!isLandable(body.desc)) {
      hud.toast(TEXT.sandbox.planNotLandable);
      return;
    }
    planning = true;
    const id = encodeWorld(worldParamsOf(app.system.system, body.desc));
    hud.toast(`${TEXT.sandbox.planning} ${body.desc.name}`);
    void app.captureFrame().then((shot) => {
      saveWorldShot(id, shot);
      // The 3D engine has no warm shutdown: the mission screens open on a fresh page.
      location.href = `${location.pathname}?world=${encodeURIComponent(id)}`;
    });
  };

  app.onFrame((dt) => {
    const input = app.input;
    if (!menu.isOpen && !mapOpen && input.justPressed('Tab')) openMap();
    if (!menu.isOpen) {
      if (input.justPressed('KeyH') || input.justPressed('F1')) menu.open('controls');
      if (input.justPressed('KeyJ')) menu.open('logbook');
      if (input.justPressed('KeyP')) planMissionHere();
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
      hidden: menu.isOpen || mapOpen,
      promptClick: !menu.isOpen && !input.locked && !skipStart,
    });
  });
  if (params.has('debug')) new DebugHud(uiRoot, app);
  return app;
}
