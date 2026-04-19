import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router-dom';

export default function LandingPage() {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col items-center justify-center min-h-[100dvh] p-6 relative overflow-hidden">
      <div className="glow-sphere top-[-10%] left-[-10%]" />
      <div className="glow-sphere bottom-[-10%] right-[-10%] opacity-20" />
      
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1 }}
        className="text-center z-10"
      >
        <header className="mb-12">
          <h1 className="brand-text text-6xl md:text-8xl mb-2">
            Shutter Studio
          </h1>
          <div className="wave-line" />
        </header>

        <p className="text-white/40 text-sm tracking-[0.3em] uppercase mb-12 font-light italic">
          Luxury Interactive Slingshot Experience
        </p>

        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => navigate('/modes')}
          className="luxury-button text-xl tracking-wider"
        >
          START
        </motion.button>
      </motion.div>

      <footer className="absolute bottom-10 text-[10px] uppercase tracking-[0.2em] text-white/20">
        Event ID: STUDIO_LUXE_2024 • Powered by Shutter Studio Core
      </footer>
    </div>
  );
}
