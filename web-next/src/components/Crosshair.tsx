import React, { useEffect, useRef, RefObject } from 'react';

const lerp = (a: number, b: number, n: number): number => (1 - n) * a + n * b;

const getMousePos = (e: Event, container?: HTMLElement | null): { x: number; y: number } => {
  const mouseEvent = e as MouseEvent;
  if (container) {
    const bounds = container.getBoundingClientRect();
    return {
      x: mouseEvent.clientX - bounds.left,
      y: mouseEvent.clientY - bounds.top
    };
  }
  return { x: mouseEvent.clientX, y: mouseEvent.clientY };
};

interface CrosshairProps {
  color?: string;
  glowColor?: string;
  containerRef?: RefObject<HTMLElement | null>;
}

const Crosshair: React.FC<CrosshairProps> = ({
  color = 'white',
  glowColor,
  containerRef = null
}) => {
  const cursorRef = useRef<HTMLDivElement>(null);
  const lineHorizontalRef = useRef<HTMLDivElement>(null);
  const lineVerticalRef = useRef<HTMLDivElement>(null);
  const mouseRef = useRef({ x: 0, y: 0 });
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const lines = [lineHorizontalRef.current, lineVerticalRef.current].filter(Boolean) as HTMLDivElement[];
    lines.forEach((line) => {
      line.style.opacity = '0';
      line.style.transition = 'opacity 180ms ease-out';
    });

    const handleMouseMove = (ev: Event) => {
      const mouseEvent = ev as MouseEvent;
      mouseRef.current = getMousePos(mouseEvent, containerRef?.current);
      if (containerRef?.current) {
        const bounds = containerRef.current.getBoundingClientRect();
        if (
          mouseEvent.clientX < bounds.left ||
          mouseEvent.clientX > bounds.right ||
          mouseEvent.clientY < bounds.top ||
          mouseEvent.clientY > bounds.bottom
        ) {
          lines.forEach((line) => {
            line.style.opacity = '0';
          });
        } else {
          lines.forEach((line) => {
            line.style.opacity = '1';
          });
        }
      }
    };

    const target: HTMLElement | Window = containerRef?.current || window;
    target.addEventListener('mousemove', handleMouseMove);

    const renderedStyles: {
      [key: string]: { previous: number; current: number; amt: number };
    } = {
      tx: { previous: 0, current: 0, amt: 0.15 },
      ty: { previous: 0, current: 0, amt: 0.15 }
    };

    const onMouseMove = () => {
      renderedStyles.tx.previous = renderedStyles.tx.current = mouseRef.current.x;
      renderedStyles.ty.previous = renderedStyles.ty.current = mouseRef.current.y;

      lines.forEach((line) => {
        line.style.opacity = '1';
      });

      rafRef.current = requestAnimationFrame(render);

      target.removeEventListener('mousemove', onMouseMove);
    };

    target.addEventListener('mousemove', onMouseMove);

    const render = () => {
      renderedStyles.tx.current = mouseRef.current.x;
      renderedStyles.ty.current = mouseRef.current.y;

      for (const key in renderedStyles) {
        const style = renderedStyles[key];
        style.previous = lerp(style.previous, style.current, style.amt);
      }

      if (lineHorizontalRef.current && lineVerticalRef.current) {
        lineVerticalRef.current.style.transform = `translateX(${renderedStyles.tx.previous}px)`;
        lineHorizontalRef.current.style.transform = `translateY(${renderedStyles.ty.previous}px)`;
      }

      rafRef.current = requestAnimationFrame(render);
    };

    return () => {
      target.removeEventListener('mousemove', handleMouseMove);
      target.removeEventListener('mousemove', onMouseMove);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [containerRef]);

  return (
    <div
      ref={cursorRef}
      className="cursor"
      style={{
        position: containerRef ? 'absolute' : 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 10000
      }}
    >
      <div
        ref={lineHorizontalRef}
        style={{
          position: 'absolute',
          width: '100%',
          height: '1px',
          background: color,
          boxShadow: glowColor ? `0 0 8px ${glowColor}, 0 0 18px ${glowColor}` : undefined,
          pointerEvents: 'none',
          transform: 'translateY(50%)',
          opacity: 0
        }}
      />
      <div
        ref={lineVerticalRef}
        style={{
          position: 'absolute',
          height: '100%',
          width: '1px',
          background: color,
          boxShadow: glowColor ? `0 0 8px ${glowColor}, 0 0 18px ${glowColor}` : undefined,
          pointerEvents: 'none',
          transform: 'translateX(50%)',
          opacity: 0
        }}
      />
    </div>
  );
};

export default Crosshair;
