import React, { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Stage, Layer, Line, Text as KonvaText, Rect, Group, Image as KonvaImage } from 'react-konva';
import { socketService } from '../socket';
import confetti from 'canvas-confetti';

interface LaunchItem {
  id: string;
  type: string;
  payload: any;
  velocity: number;
  direction: { x: number; y: number };
  x: number;
  y: number;
  rotation: number;
  timestamp: number;
}

import { collection, query, orderBy, limit, onSnapshot, getDocs, doc, getDocFromServer } from 'firebase/firestore';
import { db } from '../firebase';

export default function DisplayPage() {
  const [items, setItems] = useState<LaunchItem[]>([]);
  const processedIds = useRef<Set<string>>(new Set());
  const [dimensions, setDimensions] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [dbStatus, setDbStatus] = useState<'connecting' | 'online' | 'error'>('connecting');
  const audioCtxRef = useRef<AudioContext | null>(null);

  const testDbConnection = async () => {
    try {
      // Test the connection as per security best practices
      await getDocFromServer(doc(db, '_internal', 'connectivity_test'));
      setDbStatus('online');
    } catch (error: any) {
      if (error.code === 'permission-denied') {
        // This is actually GOOD - it means we reached the server and rules blocked the nonexistent path
        setDbStatus('online');
      } else {
        console.error("DB Connection Error:", error);
        setDbStatus('error');
      }
    }
  };

  const enableAudio = () => {
    if (audioEnabled) return;
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioContextClass) {
        audioCtxRef.current = new AudioContextClass();
        // One-time tone to unlock
        const osc = audioCtxRef.current.createOscillator();
        const gain = audioCtxRef.current.createGain();
        gain.gain.value = 0.001;
        osc.connect(gain);
        gain.connect(audioCtxRef.current.destination);
        osc.start();
        osc.stop(0.1);
        setAudioEnabled(true);
      }
    } catch (e) {
      console.warn('Audio context creation failed', e);
    }
  };

  const dimRef = useRef(dimensions);
  useEffect(() => { dimRef.current = dimensions; }, [dimensions]);

  useEffect(() => {
    socketService.connect();
    testDbConnection();
    
    // Ensure room join happens even if connection is delayed
    const joinInterval = setInterval(() => {
      if (socketService.getSocket()?.connected) {
        socketService.joinDisplay();
        clearInterval(joinInterval);
      }
    }, 1000);

    const handleResize = () => setDimensions({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', handleResize);

    // Initial sync and real-time fallback from Firestore
    const q = query(collection(db, 'items'), orderBy('createdAt', 'desc'), limit(50));
    
    const addLaunchItem = (data: any, fallbackId: string, forceFresh = false) => {
      const currentDims = dimRef.current;
      const uniqueId = data.payload?.launchId || fallbackId;
      
      if (!processedIds.current.has(uniqueId)) {
        processedIds.current.add(uniqueId);
        
        // Use forced fresh status (socket or live firestore) 
        // fallback to time-based check only if forceFresh is false
        const createdAt = data.createdAt ? data.createdAt.toMillis() : Date.now();
        const isFresh = forceFresh || (Math.abs(Date.now() - createdAt) < 15000);
        
        let initialX = currentDims.width / 2;
        let initialY = currentDims.height / 2;

        if (!isFresh) {
          // Spread items out on reload but keep them within screen bounds
          const padding = 100;
          initialX = padding + Math.random() * (currentDims.width - padding * 2);
          initialY = padding + Math.random() * (currentDims.height - padding * 2);
        }

        const newItem: LaunchItem = {
          id: uniqueId,
          ...data,
          x: initialX,
          y: initialY,
          rotation: (Math.random() - 0.5) * 30,
          isInitial: !isFresh
        } as any;

        setItems(prev => [...prev, newItem]);
        if (isFresh) {
          playLaunchSound();
          setTimeout(() => {
            confetti({
              particleCount: 100,
              spread: 70,
              origin: { y: 0.6 },
              colors: ['#bf5af2', '#ff2d55', '#ffffff']
            });
          }, 500);
        }
      }
    };

    let isSyncingInitial = true;
    const unsubscribeFirestore = onSnapshot(q, (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'added') {
          // If we are still in the first snapshot, these are "Old/Existing" items
          // If snapshot has metadata.hasPendingWrites, it's a local update
          // If it's a live update after initial load, force it to be fresh
          const forceFresh = !isSyncingInitial;
          addLaunchItem(change.doc.data(), change.doc.id, forceFresh);
        } else if (change.type === 'removed') {
          setItems(prev => prev.filter(item => item.id !== change.doc.id));
          processedIds.current.delete(change.doc.id);
        }
      });
      isSyncingInitial = false;
    });

    socketService.onNewLaunch((data: any) => {
      // Sockets provide faster feedback
      console.log('Socket launch received:', data);
      const tempId = `socket-${Date.now()}-${Math.random()}`;
      addLaunchItem(data, tempId, true);
    });

    socketService.getSocket()?.on('admin-action', (data: any) => {
      if (data.action === 'clear') {
        setItems([]);
        processedIds.current.clear();
      }
    });

    return () => {
      window.removeEventListener('resize', handleResize);
      unsubscribeFirestore();
      socketService.disconnect();
    };
  }, []);

  const playLaunchSound = () => {
    if (!audioEnabled || !audioCtxRef.current) return;
    
    try {
      const audioCtx = audioCtxRef.current;
      if (audioCtx.state === 'suspended') {
        audioCtx.resume();
      }
      
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(440, audioCtx.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 1);

      gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 1);

      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);

      oscillator.start();
      oscillator.stop(audioCtx.currentTime + 1);
    } catch (e) {
      console.warn('Audio play failed', e);
    }
  };

  return (
    <div className="fixed inset-0 bg-bg-deep overflow-hidden select-none touch-none" onClick={enableAudio}>
      {!audioEnabled && (
        <div className="absolute inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md">
          <motion.button
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            onClick={enableAudio}
            className="px-8 py-4 bg-accent-glow text-white rounded-full font-bold shadow-[0_0_30px_rgba(191,90,242,0.5)]"
          >
            INITIALIZE DISPLAY ENGINE
          </motion.button>
        </div>
      )}
      <div className="glow-sphere top-[20%] left-[20%] opacity-20" />
      <div className="glow-sphere bottom-[20%] right-[20%] opacity-10" />

      {/* Atmospheric Background */}
      <div className="absolute inset-0 z-0">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_-20%,#3a1c5e_0%,#0d0216_70%)]" />
      </div>

      <Stage width={dimensions.width} height={dimensions.height} className="z-10">
        <Layer>
          {items.map((item) => (
            <DisplayItem key={item.id} item={item} screenWidth={dimensions.width} screenHeight={dimensions.height} />
          ))}
        </Layer>
      </Stage>

      {/* Floating Branded UI */}
      <div className="absolute top-12 left-12 z-20">
        <h1 className="brand-text text-5xl opacity-40">Shutter Studio</h1>
        <div className="wave-line !ml-0 w-24 opacity-20" />
      </div>

      <div className="absolute bottom-12 right-12 z-20">
         <div className="glass px-6 py-3 rounded-full flex items-center gap-3">
            <div className={`w-2 h-2 rounded-full animate-pulse shadow-lg ${dbStatus === 'online' ? 'bg-green-500 shadow-green-500' : 'bg-red-500 shadow-red-500'}`} />
            <span className="text-[10px] uppercase tracking-[0.4em] text-white/40 font-bold">
              {dbStatus === 'online' ? 'Global Cloud Online' : 'Attempting Connection...'}
            </span>
         </div>
      </div>
    </div>
  );

}

function DisplayItem({ item, screenWidth, screenHeight }: { item: LaunchItem & { isInitial?: boolean }, screenWidth: number, screenHeight: number }) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [visibleLines, setVisibleLines] = useState<any[]>([]);
  
  const [pos, setPos] = useState({ 
    x: item.isInitial ? (item.x || screenWidth / 2) : screenWidth / 2, 
    y: item.isInitial ? (item.y || screenHeight / 2) : screenHeight + 100 
  });
  
  const [opacity, setOpacity] = useState(item.isInitial ? 1 : 0);
  const [scale, setScale] = useState(item.isInitial ? 1 : 0.1);

  useEffect(() => {
    if (item.type === 'image' && item.payload.image) {
      const img = new Image();
      // Only set crossOrigin if it's not a data URL
      if (!item.payload.image.startsWith('data:')) {
        img.crossOrigin = 'Anonymous';
      }
      img.src = item.payload.image;
      img.onload = () => setImage(img);
      img.onerror = (e) => console.error("Image load error on display:", e);
    }

    if (item.type === 'draw' && item.payload.lines) {
      if (item.isInitial) {
        setVisibleLines(item.payload.lines);
      } else {
        // Replay drawing motion
        const lines = item.payload.lines;
        let lineIdx = 0;
        let ptIdx = 2;
        
        const timer = setInterval(() => {
          if (lineIdx >= lines.length) {
            clearInterval(timer);
            return;
          }

          const line = lines[lineIdx];
          setVisibleLines(prev => {
            const next = [...prev];
            if (!next[lineIdx]) {
              next[lineIdx] = { ...line, points: line.points.slice(0, ptIdx) };
            } else {
              next[lineIdx] = { ...line, points: line.points.slice(0, ptIdx) };
            }
            return next;
          });

          ptIdx += 2;
          if (ptIdx > line.points.length) {
            lineIdx++;
            ptIdx = 2;
          }
        }, 30);
        return () => clearInterval(timer);
      }
    }

    if (item.isInitial) return;

    // Movement animation
    // Ensure target coordinates don't fly off-screen
    const padding = 150;
    const rawTargetX = item.x || (screenWidth / 2 + (item.direction.x * item.velocity * 10) + (Math.random() - 0.5) * 400);
    const rawTargetY = item.y || (screenHeight / 2 + (item.direction.y * item.velocity * 10) + (Math.random() - 0.5) * 400);
    
    const targetX = Math.max(padding, Math.min(screenWidth - padding, rawTargetX));
    const targetY = Math.max(padding, Math.min(screenHeight - padding, rawTargetY));

    let frame = 0;
    const animate = () => {
      frame++;
      if (frame < 60) {
        setPos(prev => ({
          x: prev.x + (targetX - prev.x) * 0.1,
          y: prev.y + (targetY - prev.y) * 0.1
        }));
        setOpacity(prev => Math.min(prev + 0.1, 1));
        setScale(prev => Math.min(prev + 0.05, 1));
        requestAnimationFrame(animate);
      }
    };
    requestAnimationFrame(animate);
  }, []);

  const textWidth = Math.min(screenWidth * 0.85, 800);
  
  if (item.type === 'text') {
    return (
      <KonvaText
        x={pos.x}
        y={pos.y}
        text={item.payload.text}
        fontSize={item.payload.fontSize || 40}
        fill={item.payload.color}
        fontFamily="Georgia, serif"
        fontStyle="italic"
        align="center"
        width={textWidth}
        offsetX={textWidth / 2} 
        wrap="word"
        opacity={opacity}
        scaleX={scale}
        scaleY={scale}
        rotation={item.rotation}
        shadowColor="rgba(0,0,0,0.5)"
        shadowBlur={10}
      />
    );
  }

  if (item.type === 'draw') {
    return (
      <Group
        x={pos.x}
        y={pos.y}
        opacity={opacity}
        scaleX={scale}
        scaleY={scale}
        rotation={item.rotation}
      >
        {visibleLines.map((line: any, i: number) => (
          <Line
            key={i}
            points={line.points}
            stroke={line.color}
            strokeWidth={6}
            tension={0.5}
            lineCap="round"
            lineJoin="round"
            shadowBlur={5}
            shadowColor={line.color}
          />
        ))}
      </Group>
    );
  }

  if (item.type === 'image') {
    return (
      <Group
        x={pos.x}
        y={pos.y}
        opacity={opacity}
        scaleX={scale}
        scaleY={scale}
        rotation={item.rotation}
      >
        {image && (
          <KonvaImage
            image={image}
            width={300}
            height={300}
            offsetX={150}
            offsetY={150}
            shadowBlur={30}
            shadowColor="rgba(0,0,0,0.5)"
            cornerRadius={30}
          />
        )}
      </Group>
    );
  }

  return null;
}
