import { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { LogIn, LogOut } from 'lucide-react';
import { auth, signInWithGoogle, logOut } from '../firebase';
import { onAuthStateChanged, User } from 'firebase/auth';

export default function GlobalAuth() {
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

  return (
    <div className="font-sans relative">
      {user ? (
        <div className="pointer-events-auto flex items-center gap-2 pr-2">
          <img src={user.photoURL || ''} alt="Avatar" className="w-7 h-7 rounded-full" />
          <span className="text-sm font-medium text-gray-700 hidden md:block max-w-[100px] truncate">{user.displayName}</span>
          <button onClick={logOut} className="text-gray-400 hover:text-gray-600 transition-colors ml-1" title="Log out">
            <LogOut size={16} />
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-end gap-2">
          <button 
            onClick={handleLogin}
            className="pointer-events-auto flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors px-2 py-1.5"
          >
            <LogIn size={16} />
            Login
          </button>
          {authError && (
            <motion.div 
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="absolute top-full right-0 mt-2 text-xs font-medium text-red-500 bg-red-50 px-3 py-1.5 rounded-lg shadow-sm border border-red-100 whitespace-nowrap z-50"
            >
              {authError}
            </motion.div>
          )}
        </div>
      )}
    </div>
  );
}
