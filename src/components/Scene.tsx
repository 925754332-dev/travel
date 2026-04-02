import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Float, Sparkles, RoundedBox, Sphere, Cylinder, Torus, Text, Text3D, Center } from '@react-three/drei';
import * as THREE from 'three';
import { MotionValue } from 'motion/react';

interface SceneProps {
  progress: MotionValue<number>;
}

// 1. Glossy Plastic (高光塑料) - Like polished vinyl or resin
const GlossyPlastic = ({ color }: { color: string }) => (
  <meshPhysicalMaterial
    color={color}
    roughness={0.15}
    metalness={0.05}
    clearcoat={1}
    clearcoatRoughness={0.1}
  />
);

// 2. Matte Plastic (哑光塑料) - Like soft touch silicone
const MattePlastic = ({ color }: { color: string }) => (
  <meshPhysicalMaterial
    color={color}
    roughness={0.6}
    metalness={0}
    clearcoat={0.1}
    clearcoatRoughness={0.4}
  />
);

// 3. Screen/Glass Material (屏幕/深色玻璃)
const ScreenMaterial = () => (
  <meshPhysicalMaterial
    color="#1a1a1a"
    roughness={0.1}
    metalness={0.8}
    clearcoat={1}
  />
);

// 4. Metal Material (金属) - For the clipboard clip
const MetalMaterial = ({ color = "#cccccc" }: { color?: string }) => (
  <meshStandardMaterial
    color={color}
    roughness={0.2}
    metalness={0.8}
  />
);

// 5. Fluffy Plush (毛绒材质) - Like velvet or cotton plush toy
const FluffyPlush = ({ color }: { color: string }) => (
  <meshPhysicalMaterial
    color={color}
    roughness={0.9}
    metalness={0}
    sheen={1}
    sheenRoughness={0.8}
    sheenColor="#ffffff"
    clearcoat={0}
  />
);

const Coin = () => {
  const goldColor = "#f4c430"; // Brighter, classic gold (Saffron/Gold)
  const shadowColor = "#b8860b"; // Adjusted shadow to match brighter gold
  const thickness = 0.14; // Good solid thickness
  const halfT = thickness / 2;
  const rimRadius = 0.48;
  const rimThickness = 0.04;
  const coinRadius = rimRadius + rimThickness; // 0.52 - perfectly flush with the rim
  const innerRadius = 0.40;
  
  return (
    <group>
      {/* Main body (flat sides, perfectly flush with the outer rim) */}
      <Cylinder args={[coinRadius, coinRadius, thickness, 64]} castShadow>
        <meshStandardMaterial color={goldColor} metalness={0.75} roughness={0.35} />
      </Cylinder>
      
      {/* Raised rims (outer edge) - Top and Bottom */}
      <Torus args={[rimRadius, rimThickness, 16, 64]} position={[0, halfT, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <meshStandardMaterial color={goldColor} metalness={0.75} roughness={0.35} />
      </Torus>
      <Torus args={[rimRadius, rimThickness, 16, 64]} position={[0, -halfT, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <meshStandardMaterial color={goldColor} metalness={0.75} roughness={0.35} />
      </Torus>

      {/* Inner stepped rims - Top and Bottom */}
      <Torus args={[innerRadius, 0.015, 16, 64]} position={[0, halfT, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <meshStandardMaterial color={goldColor} metalness={0.75} roughness={0.35} />
      </Torus>
      <Torus args={[innerRadius, 0.015, 16, 64]} position={[0, -halfT, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <meshStandardMaterial color={goldColor} metalness={0.75} roughness={0.35} />
      </Torus>
      
      {/* Inner decorative ring (stars/dots) */}
      {Array.from({ length: 24 }).map((_, i) => {
        const angle = (i / 24) * Math.PI * 2;
        const radius = 0.34;
        return (
          <group key={i} rotation={[0, -angle, 0]}>
            <Sphere args={[0.015, 8, 8]} position={[radius, halfT + 0.005, 0]}>
              <meshStandardMaterial color={goldColor} metalness={0.75} roughness={0.35} />
            </Sphere>
            <Sphere args={[0.015, 8, 8]} position={[radius, -(halfT + 0.005), 0]}>
              <meshStandardMaterial color={goldColor} metalness={0.75} roughness={0.35} />
            </Sphere>
          </group>
        );
      })}
      
      {/* Embossed symbol - Top */}
      <Text position={[0.01, halfT + 0.001, 0.01]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.4} color={shadowColor} fontWeight="bold">
        $
      </Text>
      <Text position={[0, halfT + 0.002, 0]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.4} color={goldColor} fontWeight="bold">
        $
      </Text>

      {/* Embossed symbol - Bottom */}
      <Text position={[0.01, -(halfT + 0.001), 0.01]} rotation={[Math.PI / 2, 0, 0]} fontSize={0.4} color={shadowColor} fontWeight="bold">
        $
      </Text>
      <Text position={[0, -(halfT + 0.002), 0]} rotation={[Math.PI / 2, 0, 0]} fontSize={0.4} color={goldColor} fontWeight="bold">
        $
      </Text>
    </group>
  );
};

const Suitcase = () => {
  const bodyColor = "#ffc8dd";
  const bumperColor = "#ffffff";
  const metalColor = "#cccccc";
  const wheelColor = "#333333";

  return (
    <group>
      {/* Main Body */}
      <RoundedBox args={[1.5, 2.0, 0.7]} radius={0.15} castShadow>
        <GlossyPlastic color={bodyColor} />
      </RoundedBox>

      {/* Vertical Ribs (Front and Back) */}
      {[-0.4, -0.2, 0, 0.2, 0.4].map((x, i) => (
        <group key={`rib-${i}`}>
          <RoundedBox args={[0.08, 1.8, 0.72]} radius={0.02} position={[x, 0, 0]}>
            <GlossyPlastic color={bodyColor} />
          </RoundedBox>
        </group>
      ))}

      {/* Zipper Line (Middle seam) - Fixed corner clipping by matching body radius */}
      <RoundedBox args={[1.52, 2.02, 0.02]} radius={0.16} position={[0, 0, 0]}>
        <MattePlastic color="#444444" />
      </RoundedBox>

      {/* Telescopic Handle (Extended) */}
      <group position={[0, 1.0, -0.2]}>
        {/* Metal Tubes */}
        <Cylinder args={[0.025, 0.025, 0.4, 16]} position={[-0.25, 0.2, 0]}>
          <meshStandardMaterial color={metalColor} metalness={0.8} roughness={0.2} />
        </Cylinder>
        <Cylinder args={[0.025, 0.025, 0.4, 16]} position={[0.25, 0.2, 0]}>
          <meshStandardMaterial color={metalColor} metalness={0.8} roughness={0.2} />
        </Cylinder>
        {/* Top Grip */}
        <RoundedBox args={[0.6, 0.08, 0.12]} radius={0.02} position={[0, 0.4, 0]}>
          <MattePlastic color={bumperColor} />
        </RoundedBox>
        <RoundedBox args={[0.4, 0.04, 0.13]} radius={0.01} position={[0, 0.4, 0]}>
          <GlossyPlastic color={bodyColor} />
        </RoundedBox>
      </group>

      {/* Top Handle (U-shape, hollow, low profile) */}
      <group position={[0, 1.0, 0]}>
        <Cylinder args={[0.025, 0.025, 0.04, 16]} position={[-0.2, 0.02, 0]}>
          <MattePlastic color={bumperColor} />
        </Cylinder>
        <Cylinder args={[0.025, 0.025, 0.04, 16]} position={[0.2, 0.02, 0]}>
          <MattePlastic color={bumperColor} />
        </Cylinder>
        <RoundedBox args={[0.5, 0.04, 0.08]} radius={0.015} position={[0, 0.04, 0]}>
          <MattePlastic color={bumperColor} />
        </RoundedBox>
      </group>

      {/* Side Handle (U-shape, hollow, low profile) */}
      <group position={[0.75, 0, 0]}>
        <Cylinder args={[0.025, 0.025, 0.04, 16]} rotation={[0, 0, Math.PI / 2]} position={[0.02, 0.2, 0]}>
          <MattePlastic color={bumperColor} />
        </Cylinder>
        <Cylinder args={[0.025, 0.025, 0.04, 16]} rotation={[0, 0, Math.PI / 2]} position={[0.02, -0.2, 0]}>
          <MattePlastic color={bumperColor} />
        </Cylinder>
        <RoundedBox args={[0.04, 0.5, 0.08]} radius={0.015} position={[0.04, 0, 0]}>
          <MattePlastic color={bumperColor} />
        </RoundedBox>
      </group>

      {/* Wheels (4 Spinner Wheels with forks) */}
      {[-1, 1].map((x) => 
        [-1, 1].map((z) => (
          <group key={`wheel-${x}-${z}`} position={[x * 0.55, -0.95, z * 0.25]}>
            {/* Wheel Mount Base */}
            <Cylinder args={[0.06, 0.05, 0.08, 16]} position={[0, -0.04, 0]}>
              <MattePlastic color={bumperColor} />
            </Cylinder>
            {/* Wheel Fork */}
            <RoundedBox args={[0.04, 0.12, 0.08]} radius={0.01} position={[0.04, -0.1, 0]}>
              <MattePlastic color={bumperColor} />
            </RoundedBox>
            {/* Wheel itself */}
            <Cylinder args={[0.08, 0.08, 0.05, 32]} rotation={[0, 0, Math.PI / 2]} position={[-0.01, -0.14, 0]}>
              <meshStandardMaterial color={wheelColor} roughness={0.7} />
            </Cylinder>
          </group>
        ))
      )}
    </group>
  );
};

export default function Scene({ progress }: SceneProps) {
  const groupRef = useRef<THREE.Group>(null);

  useFrame(() => {
    if (groupRef.current) {
      // Rotate based on infinite progress
      groupRef.current.rotation.y = progress.get() * -Math.PI;
    }
  });

  return (
    <group position={[0, 0, 0]}>
      <Sparkles count={40} scale={12} size={6} speed={0.4} opacity={0.6} color="#ffb3ba" />
      <Sparkles count={40} scale={12} size={6} speed={0.4} opacity={0.6} color="#bae1ff" />

      <group ref={groupRef}>
        {/* Base */}
        <RoundedBox args={[8, 0.4, 8]} radius={0.1} smoothness={4} position={[0, -0.2, 0]} castShadow receiveShadow>
          <MattePlastic color="#ffffff" />
        </RoundedBox>

        {/* Clipboard / Planner Board Divider */}
        <group position={[0, 2.5, 0]}>
          {/* Main Board (Warm beige/wood color) */}
          <RoundedBox args={[7.5, 5.4, 0.2]} radius={0.1} smoothness={4} castShadow receiveShadow>
            <MattePlastic color="#e8dcc7" />
          </RoundedBox>

          {/* Paper Side A (Itinerary) */}
          <RoundedBox args={[6.6, 4.8, 0.05]} radius={0.05} position={[0, -0.1, 0.12]} receiveShadow>
            <MattePlastic color="#ffffff" />
          </RoundedBox>
          {/* Paper Header Line A */}
          <RoundedBox args={[5, 0.08, 0.06]} radius={0.02} position={[0, 1.6, 0.13]}>
            <MattePlastic color="#ffb3ba" />
          </RoundedBox>
          {/* Paper Sub Line A */}
          <RoundedBox args={[3, 0.06, 0.06]} radius={0.02} position={[-1, 1.2, 0.13]}>
            <MattePlastic color="#a2d2ff" />
          </RoundedBox>

          {/* Paper Side B (Accounting) */}
          <RoundedBox args={[6.6, 4.8, 0.05]} radius={0.05} position={[0, -0.1, -0.12]} receiveShadow>
            <MattePlastic color="#ffffff" />
          </RoundedBox>
          {/* Paper Header Line B */}
          <RoundedBox args={[5, 0.08, 0.06]} radius={0.02} position={[0, 1.6, -0.13]}>
            <MattePlastic color="#baffc9" />
          </RoundedBox>
          {/* Paper Sub Line B */}
          <RoundedBox args={[4, 0.06, 0.06]} radius={0.02} position={[-0.5, 1.2, -0.13]}>
            <MattePlastic color="#ffd670" />
          </RoundedBox>

          {/* Clip Mechanism (Top) */}
          <group position={[0, 2.5, 0]}>
            {/* Clip Base */}
            <RoundedBox args={[2.5, 0.8, 0.35]} radius={0.1} castShadow>
              <MetalMaterial color="#dcdcdc" />
            </RoundedBox>
            {/* Clip Spring/Hinge */}
            <Cylinder args={[0.25, 0.25, 2.6, 16]} rotation={[0, 0, Math.PI/2]} position={[0, 0.1, 0]} castShadow>
              <MetalMaterial color="#a0a0a0" />
            </Cylinder>
            {/* Clip Hole for hanging */}
            <Torus args={[0.25, 0.08, 16, 32]} position={[0, 0.6, 0]} castShadow>
              <MetalMaterial color="#dcdcdc" />
            </Torus>
          </group>
        </group>

        {/* Side A: Itinerary (Z > 0) */}
        <group position={[0, 0, 1.5]}>
          <Itinerary />
        </group>

        {/* Travel Plan Text Sculpture */}
        <group position={[0, 0.3, 3.2]}>
          <Center>
            <Text3D
              font="https://cdn.jsdelivr.net/npm/three@0.150.0/examples/fonts/helvetiker_bold.typeface.json"
              size={0.5}
              height={0.15}
              curveSegments={12}
              bevelEnabled
              bevelThickness={0.02}
              bevelSize={0.02}
              bevelOffset={0}
              bevelSegments={5}
              letterSpacing={0.02}
              castShadow
            >
              TRAVEL PLAN
              <meshStandardMaterial color="#ffafcc" metalness={0.4} roughness={0.3} />
            </Text3D>
          </Center>
        </group>

        {/* Side B: Accounting (Z < 0, rotated 180) */}
        <group position={[0, 0, -1.5]} rotation={[0, Math.PI, 0]}>
          <Accounting />
        </group>

        {/* Travel Budget Text Sculpture */}
        <group position={[0, 0.3, -3.2]} rotation={[0, Math.PI, 0]}>
          <Center>
            <Text3D
              font="https://cdn.jsdelivr.net/npm/three@0.150.0/examples/fonts/helvetiker_bold.typeface.json"
              size={0.5}
              height={0.15}
              curveSegments={12}
              bevelEnabled
              bevelThickness={0.02}
              bevelSize={0.02}
              bevelOffset={0}
              bevelSegments={5}
              letterSpacing={0.02}
              castShadow
            >
              TRAVEL BUDGET
              <meshStandardMaterial color="#baffc9" metalness={0.4} roughness={0.3} />
            </Text3D>
          </Center>
        </group>
      </group>
    </group>
  );
}

function CuteCloud({ position, scale = 1, color = "#ffffff", variant = 1 }: any) {
  return (
    <group position={position}>
      <Float speed={2.5} floatIntensity={1.5} rotationIntensity={0.2}>
        <group scale={scale}>
          {variant === 1 && (
          <>
            <Sphere args={[0.4, 32, 32]} position={[-0.5, -0.1, 0]}>
              <FluffyPlush color={color} />
            </Sphere>
            <Sphere args={[0.6, 32, 32]} position={[0, 0.1, 0]}>
              <FluffyPlush color={color} />
            </Sphere>
            <Sphere args={[0.45, 32, 32]} position={[0.5, -0.05, 0]}>
              <FluffyPlush color={color} />
            </Sphere>
          </>
        )}
        {variant === 2 && (
          <>
            <Sphere args={[0.45, 32, 32]} position={[-0.6, 0, 0]}>
              <FluffyPlush color={color} />
            </Sphere>
            <Sphere args={[0.65, 32, 32]} position={[-0.15, 0.2, 0]}>
              <FluffyPlush color={color} />
            </Sphere>
            <Sphere args={[0.5, 32, 32]} position={[0.35, 0.05, 0]}>
              <FluffyPlush color={color} />
            </Sphere>
            <Sphere args={[0.3, 32, 32]} position={[0.75, -0.1, 0]}>
              <FluffyPlush color={color} />
            </Sphere>
          </>
        )}
        {variant === 3 && (
          <>
            <Sphere args={[0.5, 32, 32]} position={[-0.3, 0, 0]}>
              <FluffyPlush color={color} />
            </Sphere>
            <Sphere args={[0.4, 32, 32]} position={[0.3, -0.1, 0]}>
              <FluffyPlush color={color} />
            </Sphere>
          </>
        )}
        </group>
      </Float>
    </group>
  );
}

function Itinerary() {
  return (
    <group>
      {/* Exquisite Camera */}
      <Float speed={2.5} rotationIntensity={0.4} floatIntensity={0.8}>
        <group position={[-1.5, 1.8, 0.5]} rotation={[0.2, 0.4, 0]}>
          {/* Main Body */}
          <RoundedBox args={[1.8, 1.3, 0.8]} radius={0.2} castShadow>
            <GlossyPlastic color="#a2d2ff" />
          </RoundedBox>
          {/* Grip/Wrap */}
          <RoundedBox args={[1.85, 0.8, 0.85]} radius={0.1} castShadow>
            <MattePlastic color="#ffffff" />
          </RoundedBox>
          {/* Lens Base */}
          <Cylinder args={[0.55, 0.55, 0.4, 32]} position={[0, 0, 0.45]} rotation={[Math.PI/2, 0, 0]} castShadow>
            <GlossyPlastic color="#ffffff" />
          </Cylinder>
          {/* Lens Glass */}
          <Cylinder args={[0.4, 0.4, 0.45, 32]} position={[0, 0, 0.45]} rotation={[Math.PI/2, 0, 0]}>
            <ScreenMaterial />
          </Cylinder>
          {/* Flash */}
          <RoundedBox args={[0.3, 0.2, 0.1]} radius={0.05} position={[0.6, 0.4, 0.45]}>
            <GlossyPlastic color="#ffffff" />
          </RoundedBox>
          {/* Viewfinder */}
          <RoundedBox args={[0.25, 0.2, 0.1]} radius={0.05} position={[-0.6, 0.4, 0.45]}>
            <ScreenMaterial />
          </RoundedBox>
          {/* Shutter Button */}
          <Cylinder args={[0.15, 0.15, 0.1, 16]} position={[0.6, 0.7, 0]} castShadow>
            <GlossyPlastic color="#ffafcc" />
          </Cylinder>
        </group>
      </Float>

      {/* Exquisite Suitcase */}
      <Float speed={2.5} rotationIntensity={0.4} floatIntensity={0.8}>
        <group position={[1.5, 1.2, 0.8]} rotation={[-0.1, -0.3, 0]}>
          <Suitcase />
        </group>
      </Float>

      {/* Clouds */}
      <CuteCloud position={[1.5, 3.5, -0.5]} scale={0.7} color="#ffffff" variant={2} />
      <CuteCloud position={[-3.0, 0.2, 0.5]} scale={0.4} color="#ffffff" variant={3} />
    </group>
  );
}

function Accounting() {
  return (
    <group>
      {/* Exquisite Calculator */}
      <Float speed={2.5} rotationIntensity={0.4} floatIntensity={0.8}>
        <group position={[-1.5, 1.8, 0.5]} rotation={[0.2, 0.3, 0]}>
          {/* Body */}
          <RoundedBox args={[1.6, 2.4, 0.4]} radius={0.2} castShadow>
            <GlossyPlastic color="#bde0fe" />
          </RoundedBox>
          {/* Screen Area */}
          <RoundedBox args={[1.3, 0.6, 0.1]} radius={0.05} position={[0, 0.7, 0.2]}>
            <ScreenMaterial />
          </RoundedBox>
          {/* Solar Panel */}
          <RoundedBox args={[0.6, 0.15, 0.1]} radius={0.02} position={[0.35, 1.1, 0.2]}>
            <meshStandardMaterial color="#333333" roughness={0.8} />
          </RoundedBox>
          {/* Buttons */}
          {[0.2, -0.3, -0.8].map((y, row) => (
            [-0.4, 0, 0.4].map((x, col) => {
              const isEquals = row === 2 && col === 2;
              return (
                <RoundedBox key={`${row}-${col}`} args={[0.3, 0.3, 0.15]} radius={0.05} position={[x, y, 0.2]} castShadow>
                  <MattePlastic color={isEquals ? "#ffafcc" : "#ffffff"} />
                </RoundedBox>
              );
            })
          ))}
        </group>
      </Float>

      {/* Exquisite Coins */}
      <Float speed={2.5} rotationIntensity={0.4} floatIntensity={0.8}>
        <group position={[1.2, 1.2, 1.2]} rotation={[0.2, -0.4, 0]}>
          {[0, 1, 2].map((i) => (
            <group key={i} position={[0, i * 0.3, 0]}>
              <Coin />
            </group>
          ))}
          <group position={[0.5, 0.9, 0]} rotation={[0.4, 0, 0.2]}>
            <Coin />
          </group>
        </group>
      </Float>

      {/* Clouds */}
      <CuteCloud position={[1.5, 3.5, -0.5]} scale={0.7} color="#ffffff" variant={2} />
      <CuteCloud position={[-3.0, 0.2, 0.5]} scale={0.4} color="#ffffff" variant={3} />
    </group>
  );
}
