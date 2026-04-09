import { motion, useTransform, MotionValue } from 'motion/react';
import { ArrowLeft, ArrowRight, Map, Receipt, LogIn, LogOut } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { auth, signInWithGoogle, logOut } from '../firebase';
import { onAuthStateChanged, User } from 'firebase/auth';

interface UIOverlayProps {
  progress: MotionValue<number>;
}

export default function UIOverlay({ progress }: UIOverlayProps) {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });
    return () => unsubscribe();
  }, []);

  const handleLogin = async () => {
    try {
      setAuthError(null);
      await signInWithGoogle();
    } catch (error: any) {
      setAuthError(error.message || "Sign-in failed");
      setTimeout(() => setAuthError(null), 5000);
    }
  };

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
        <div className="text-2xl font-bold tracking-tighter bg-gradient-to-r from-[#ff8fab] to-[#70c1ff] bg-clip-text text-transparent">
          AmiTrip.
        </div>
        <div className="flex items-center gap-4 md:gap-8">
          <div className="hidden md:flex gap-8 text-xs font-bold tracking-widest uppercase pointer-events-auto">
            <motion.span 
              style={{ color: colorA }}
              className="cursor-pointer hover:opacity-70 transition-opacity"
              onClick={() => navigate('/plan')}
            >
              Plan
            </motion.span>
            <motion.span 
              style={{ color: colorB }}
              className="cursor-pointer hover:opacity-70 transition-opacity"
              onClick={() => navigate('/budget')}
            >
              Budget
            </motion.span>
          </div>

          {user ? (
            <div className="pointer-events-auto flex items-center gap-3 bg-white/50 backdrop-blur-sm pl-2 pr-4 py-1.5 rounded-full">
              <img src={user.photoURL || ''} alt="Avatar" className="w-6 h-6 rounded-full" />
              <span className="text-xs font-bold text-slate-600 hidden md:block">{user.displayName}</span>
              <button onClick={logOut} className="text-slate-500 hover:text-slate-800 transition-colors ml-2">
                <LogOut size={14} />
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-end gap-2">
              <button 
                onClick={handleLogin}
                className="pointer-events-auto flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-slate-500 hover:text-slate-800 transition-colors bg-white/50 backdrop-blur-sm px-4 py-2 rounded-full"
              >
                <LogIn size={14} />
                Login
              </button>
              {authError && (
                <motion.div 
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-[10px] font-bold text-red-400 bg-red-50/80 backdrop-blur-sm px-3 py-1 rounded-full pointer-events-auto"
                >
                  {authError}
                </motion.div>
              )}
            </div>
          )}
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
