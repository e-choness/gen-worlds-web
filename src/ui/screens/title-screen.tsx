import { TEXT } from '@/ui/text';

export interface TitleScreenProps {
  /** False while WebGPU is missing or still being probed: the sandbox is 3D only. */
  sandboxAvailable: boolean;
  onNewMission: () => void;
  onCrew: () => void;
  onDaily: () => void;
  onSandbox: () => void;
}

export function TitleScreen({
  sandboxAvailable,
  onNewMission,
  onCrew,
  onDaily,
  onSandbox,
}: TitleScreenProps) {
  return (
    <section class="screen title-screen">
      <div class="eyebrow">{TEXT.title.eyebrow}</div>
      <h1>{TEXT.brand}</h1>
      <p class="lede">{TEXT.title.lede}</p>
      <div class="actions column">
        <button type="button" class="button primary" data-autofocus onClick={onNewMission}>
          {TEXT.title.newMission}
        </button>
        <button type="button" class="button" onClick={onDaily}>
          {TEXT.title.daily}
        </button>
        <button type="button" class="button" onClick={onCrew}>
          {TEXT.title.crew}
        </button>
        <button type="button" class="button" disabled={!sandboxAvailable} onClick={onSandbox}>
          {sandboxAvailable ? TEXT.title.sandbox : TEXT.title.sandboxNeedsWebgpu}
        </button>
      </div>
      <p class="footnote">{TEXT.title.footnote}</p>
    </section>
  );
}
