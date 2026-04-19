import React from 'react';
import { motion } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { Type, Palette, Image as ImageIcon } from 'lucide-react';

export default function ModeSelection() {
  const navigate = useNavigate();

  const modes = [
    { id: 'text', icon: Type, label: 'Write Text', color: 'from-blue-500 to-indigo-600' },
    { id: 'draw', icon: Palette, label: 'Draw Canvas', color: 'from-purple-500 to-pink-600' },
    { id: 'image', icon: ImageIcon, label: 'Upload Image', color: 'from-orange-500 to-red-600' },
  ];

  return (
    <div className="flex flex-col items-center justify-center min-h-[100dvh] p-6 relative overflow-hidden">
      <div className="glow-sphere top-[10%] right-[10%] opacity-20" />
      <div className="glow-sphere bottom-[10%] left-[10%] opacity-10" />

      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center mb-16"
      >
        <span className="text-xs uppercase tracking-[0.5em] text-accent-glow font-bold mb-4 block">Select Mode</span>
        <h2 className="brand-text text-4xl">What would you like to create?</h2>
        <div className="wave-line w-32 mt-4" />
      </motion.div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8 w-full max-w-5xl z-10">
        {modes.map((mode, index) => (
          <motion.div
            key={mode.id}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: index * 0.1 }}
            whileHover={{ scale: 1.05, y: -5 }}
            onClick={() => navigate(`/create/${mode.id}`)}
            className="glass p-10 rounded-[30px] cursor-pointer group flex flex-col items-center text-center relative overflow-hidden"
          >
            <div className="w-16 h-16 rounded-2xl bg-accent-glow flex items-center justify-center mb-8 shadow-[0_10px_25px_rgba(191,90,242,0.3)] transition-all group-hover:scale-110 group-hover:rotate-6">
              <mode.icon size={32} className="text-white" />
            </div>
            
            <h3 className="text-2xl font-bold tracking-tight mb-3 text-white/90">{mode.label}</h3>
            <p className="text-white/40 text-xs uppercase tracking-widest leading-relaxed">Launch your<br />creativity</p>
          </motion.div>
        ))}
      </div>
    </div>
  );

}
