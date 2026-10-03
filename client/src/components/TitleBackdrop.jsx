import { useEffect, useRef } from 'react';
import Card from './Card';
import { motionReduced } from '../settings';

// Comic-panel scene behind the title: spinning focus lines, halftone and scattered suits, and a
// burst holding a real hand of cards. The ink art is recoloured to the table theme's tones; the
// cards follow the card theme. On desktop the layers shift by different amounts with the pointer.
export default function TitleBackdrop() {
  const ref = useRef(null);

  useEffect(() => {
    const node = ref.current;
    if (motionReduced() || !window.matchMedia('(pointer: fine)').matches || !node) return undefined;
    let frame = 0;
    const follow = (event) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        node.style.setProperty('--px', (event.clientX / window.innerWidth - 0.5).toFixed(3));
        node.style.setProperty('--py', (event.clientY / window.innerHeight - 0.5).toFixed(3));
      });
    };
    window.addEventListener('pointermove', follow);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', follow);
    };
  }, []);

  return (
    <div className="title-backdrop" ref={ref} aria-hidden="true">
      <div className="title-inked">
        <div className="title-layer title-layer-burst"><img src="/textures/comic-burst.svg" alt="" /></div>
        <div className="title-layer title-layer-scene"><img src="/textures/comic-scene.svg" alt="" /></div>
        <div className="title-layer title-layer-emblem"><img src="/textures/comic-emblem.svg" alt="" /></div>
        <div className="title-tone title-tone-ink" />
        <div className="title-tone title-tone-paper" />
      </div>
      <div className="title-layer title-layer-emblem title-layer-hand">
        <div className="title-hand">
          <span className="title-hand-card"><Card code={null} delay={0.25} /></span>
          <span className="title-hand-card"><Card code="Ah" delay={0.4} /></span>
          <span className="title-hand-card"><Card code="As" delay={0.55} /></span>
        </div>
        <img className="title-hand-chips" src="/textures/comic-chips.svg" alt="" />
      </div>
    </div>
  );
}
