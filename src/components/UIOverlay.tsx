import { motion, useTransform, MotionValue } from 'motion/react';
import { ArrowLeft, ArrowRight } from 'lucide-react';

interface UIOverlayProps {
  progress: MotionValue<number>;
}

export default function UIOverlay({ progress }: UIOverlayProps) {
  // Convert infinite progress (..., -2, -1, 0, 1, 2, ...) into a 0-1 range
  // Even numbers (0, 2, -2) = 0 (Plan face)
  // Odd numbers (1, 3, -1) = 1 (Track face)
  const normalizedProgress = useTransform(progress, (v) => {
    const mod = Math.abs(v % 2);
    return mod > 1 ? 2 - mod : mod;
  });

  const indicatorX = useTransform(normalizedProgress, [0, 1], ['0%', '100%']);

  // High-end Macaron Colors
  const colorPink = '#ff8fab';
  const colorBlue = '#70c1ff';
  const colorGray = '#cbd5e1';

  const colorA = useTransform(normalizedProgress, [0, 0.5], [colorPink, colorGray]);
  const colorB = useTransform(normalizedProgress, [0.5, 1], [colorGray, colorBlue]);
  const indicatorColor = useTransform(normalizedProgress, [0, 1], [colorPink, colorBlue]);

  return (
    <div className="absolute inset-0 pointer-events-none flex flex-col justify-between p-8 md:p-16 font-sans">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div className="text-2xl font-bold tracking-tighter text-slate-400">
          WanderSync.
        </div>
        <div className="flex gap-8 text-xs font-bold tracking-widest uppercase">
          <motion.span style={{ color: colorA }}>
            Plan
          </motion.span>
          <motion.span style={{ color: colorB }}>
            Track
          </motion.span>
        </div>
      </div>

      {/* Main Text - Titles removed as requested */}
      <div className="relative h-48 flex items-center justify-center text-center">
      </div>

      {/* Footer / Slider Indicator */}
      <div className="flex flex-col items-center gap-8">
        <div className="text-slate-300 text-xs flex items-center gap-4 font-bold tracking-widest uppercase">
          <ArrowLeft size={14} />
          <span>Swipe to explore</span>
          <ArrowRight size={14} />
        </div>
        <div className="w-48 h-[3px] bg-slate-100 rounded-full relative overflow-hidden">
          <motion.div
            className="absolute top-0 bottom-0 left-0 w-1/2 rounded-full"
            style={{ x: indicatorX, backgroundColor: indicatorColor }}
          />
        </div>
      </div>
    </div>
  );
}
