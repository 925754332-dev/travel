import { useRef, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { ContactShadows, Environment, Lightformer } from '@react-three/drei';
import { useMotionValue, useSpring } from 'motion/react';
import Scene from './components/Scene';
import UIOverlay from './components/UIOverlay';

export default function App() {
  const progress = useMotionValue(0);
  const smoothProgress = useSpring(progress, { damping: 20, stiffness: 100 });

  const isDragging = useRef(false);
  const startX = useRef(0);
  const startProgress = useRef(0);

  const handlePointerDown = (e: React.PointerEvent) => {
    isDragging.current = true;
    startX.current = e.clientX;
    startProgress.current = progress.get();
    document.body.style.cursor = 'grabbing';
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging.current) return;
    const deltaX = e.clientX - startX.current;
    const deltaProgress = -deltaX / (window.innerWidth * 0.5);
    // No clamping! Allow infinite rotation
    progress.set(startProgress.current + deltaProgress);
  };

  const handlePointerUp = () => {
    if (!isDragging.current) return;
    isDragging.current = false;
    document.body.style.cursor = 'auto';

    // Snap to the nearest integer (0, 1, 2, -1, -2, etc.)
    const current = progress.get();
    progress.set(Math.round(current));
  };

  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        const current = progress.get();
        const deltaProgress = e.deltaX / 1000;
        progress.set(current + deltaProgress);
        
        clearTimeout((window as any).wheelSnapTimeout);
        (window as any).wheelSnapTimeout = setTimeout(() => {
          progress.set(Math.round(progress.get()));
        }, 150);
      }
    };

    window.addEventListener('wheel', handleWheel, { passive: true });
    return () => window.removeEventListener('wheel', handleWheel);
  }, [progress]);

  return (
    <div
      className="w-full h-screen overflow-hidden relative bg-[#faf9f8] cursor-grab active:cursor-grabbing touch-none"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <Canvas 
        camera={{ position: [0, 4.5, 16], fov: 45 }} 
        onCreated={({ camera }) => camera.lookAt(0, 1.5, 0)}
        dpr={[1, 2]} 
        shadows 
      >
        <color attach="background" args={['#faf9f8']} />
        
        {/* Natural Lighting Setup */}
        <ambientLight intensity={0.4} />
        
        {/* Sky and Ground bounce light */}
        <hemisphereLight skyColor="#e0f2fe" groundColor="#fef08a" intensity={0.6} />
        
        {/* The Sun */}
        <directionalLight 
          position={[8, 12, 8]} 
          intensity={1.8} 
          castShadow 
          shadow-mapSize={[2048, 2048]} 
          shadow-bias={-0.0001}
          shadow-normalBias={0.04}
          shadow-radius={4}
          color="#fffaf0"
        />

        {/* Natural Environment for Reflections (Sun + Sky Dome) */}
        <Environment resolution={256}>
          <group rotation={[-Math.PI / 2, 0, 0]}>
            {/* Sun reflection */}
            <Lightformer form="circle" intensity={8} rotation={[Math.PI / 2, 0, 0]} position={[8, 12, 8]} scale={[2, 2, 1]} />
            {/* Sky reflection */}
            <Lightformer form="rect" intensity={1.5} rotation={[Math.PI / 2, 0, 0]} position={[0, 10, 0]} scale={[50, 50, 1]} color="#e0f2fe" />
          </group>
        </Environment>
        
        <Scene progress={smoothProgress} />
        
        {/* Warm, soft grounding shadow */}
        <ContactShadows 
          position={[0, -2.5, 0]} 
          opacity={0.6} 
          scale={20} 
          blur={2.5} 
          far={4} 
          color="#d4c5b9"
        />
      </Canvas>

      <UIOverlay progress={smoothProgress} />
    </div>
  );
}
