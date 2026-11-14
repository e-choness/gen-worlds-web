import { TEXT } from '@/ui/text';

export interface TitleScreenProps {
  /** False while WebGPU is missing or still being probed: the sandbox is 3D only. */
  sandboxAvailable: boolean;
  onNewMission: () => void;
  onCrew: () => void;
  onDaily: () => void;
  onSandbox: () => void;
  onTour: () => void;
}

export function TitleScreen({
  sandboxAvailable,
  onNewMission,
  onCrew,
  onDaily,
  onSandbox,
  onTour,
}: TitleScreenProps) {
  const t = TEXT.title;
  return (
    <section class="screen title-screen">
      {/* Decorative: the Earth as the engine renders it from NASA Blue Marble. */}
      <img class="title-hero" src={`${import.meta.env.BASE_URL}art/title_earth.jpg`} alt="" />
      <div class="eyebrow">{TEXT.title.eyebrow}</div>
      <h1>{TEXT.brand}</h1>
      <p class="lede">{TEXT.title.lede}</p>
      <div class="title-menu">
        <button type="button" class="title-primary" data-autofocus onClick={onNewMission}>
          {t.newMission}
          <svg
            aria-hidden="true"
            width="22"
            height="22"
            viewBox="0 0 22 22"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M4 11h14M12 5l6 6-6 6" />
          </svg>
        </button>
        <button type="button" class="title-tile" onClick={onDaily}>
          <span>{t.daily}</span>
          <span class="dim">{t.dailyHint}</span>
        </button>
        <button type="button" class="title-tile" onClick={onCrew}>
          <span>{t.crew}</span>
          <span class="dim">{t.crewHint}</span>
        </button>
        <button type="button" class="title-tile" disabled={!sandboxAvailable} onClick={onTour}>
          <span>{t.tour}</span>
          <span class="dim">{sandboxAvailable ? t.tourHint : t.needsWebgpu}</span>
        </button>
        <button type="button" class="title-tile" disabled={!sandboxAvailable} onClick={onSandbox}>
          <span>{t.sandbox}</span>
          <span class="dim">{sandboxAvailable ? t.sandboxHint : t.needsWebgpu}</span>
        </button>
      </div>
      <dl class="title-facts">
        {t.facts.map((fact) => (
          <div key={fact.label}>
            <dt>{fact.label}</dt>
            <dd>{fact.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
